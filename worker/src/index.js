'use strict';

const express    = require('express');
const crypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getQueue, getQueueEvents }   = require('./queue');
const { startWorker }  = require('./worker');
const { saveCookies, loadCookies, sessionMeta, deleteSession } = require('./session');
const { getLimits }    = require('./rateLimit');
const {
  sanitizeText,
  sanitizeNote,
  validateId,
  validateProfileUrl,
  parseLimit,
} = require('./sanitizers');

const app  = express();
const PORT = process.env.PORT || 3001;

// Startup validation for ACCOUNT_IDS
if (process.env.ACCOUNT_IDS) {
  const ids = process.env.ACCOUNT_IDS.split(',');
  if (ids.some(id => !id || !id.trim())) {
    throw new Error('ACCOUNT_IDS contains empty string segments. Check for trailing commas.');
  }
}

app.use(express.json({ limit: '2mb' }));

// ── Global request timeout ───────────────────────────────────────────────────
// Set to 130 s so Express always responds before the BFF AbortSignal (120 s)
// fires, giving the client a meaningful 504 instead of a connection reset.
app.use((req, res, next) => {
  res.setTimeout(130_000, () => {
    if (!res.headersSent) res.status(504).json({ error: 'Request timed out' });
  });
  next();
});

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireApiKey(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'API_SECRET not configured' });
  }

  const provided = req.headers['x-api-key'] || '';

  if (
    provided.length !== secret.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// ── Health (no auth) ─────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── All routes below require API key ─────────────────────────────────────────

app.use(requireApiKey);

const { getRedis } = require('./redisClient');
const exportRoutes = require('./routes/export');
const { syncAccount, syncAllAccounts } = require('./services/messageSyncService');

// Mount export routes
app.use('/export', exportRoutes);

// POST /sync/messages - Manual message sync trigger
app.post('/sync/messages', async (req, res) => {
  try {
    const { accountId } = req.body;
    const proxyUrl = process.env.PROXY_URL || null;

    console.log('[API] Manual sync triggered', accountId ? `for account ${accountId}` : 'for all accounts');

    // Trigger sync in background (don't wait for completion)
    if (accountId) {
      syncAccount(accountId, proxyUrl)
        .then(stats => console.log('[API] Manual sync completed:', stats))
        .catch(err => console.error('[API] Manual sync failed:', err));
      
      res.json({ 
        success: true, 
        message: `Sync started for account ${accountId}`,
        accountId,
      });
    } else {
      syncAllAccounts(proxyUrl)
        .then(stats => console.log('[API] Manual sync completed:', stats))
        .catch(err => console.error('[API] Manual sync failed:', err));
      
      res.json({ 
        success: true, 
        message: 'Sync started for all accounts',
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /accounts
app.get('/accounts', async (_req, res) => {
  try {
    const ids   = (process.env.ACCOUNT_IDS ?? '').split(',').filter(Boolean);
    const redis = getRedis();

    const accounts = await Promise.all(
      ids.map(async (id) => {
        let isActive = false;
        let lastSeen = null;
        try {
          const metaRaw = await redis.get(`session:meta:${id}`);
          const meta    = metaRaw ? JSON.parse(metaRaw) : null;
          isActive      = !!meta;
          lastSeen      = meta?.savedAt ?? null;
        } catch (_err) { /* Redis unavailable — degrade gracefully */ }
        return { id, displayName: id, isActive, lastSeen };
      })
    );

    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// POST /accounts/:accountId/session
app.post('/accounts/:accountId/session', async (req, res) => {
  try {
    const accountId = validateId(req.params.accountId, { field: 'accountId' });
    const cookies = req.body;
    if (!Array.isArray(cookies) || cookies.length === 0 || !cookies.every(c => c && typeof c === 'object' && !Array.isArray(c))) {
      return res.status(400).json({ error: 'Body must be a non-empty array of valid cookie objects' });
    }
    await saveCookies(accountId, cookies);
    res.json({ success: true, accountId, cookieCount: cookies.length });
  } catch (err) {
    console.error('[Session Import]', err.message);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// GET /accounts/:accountId/session/status
app.get('/accounts/:accountId/session/status', async (req, res) => {
  try {
    const accountId = validateId(req.params.accountId, { field: 'accountId' });
    const meta = await sessionMeta(accountId);
    if (!meta) return res.status(404).json({ exists: false });
    res.json({ exists: true, ...meta });
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// DELETE /accounts/:accountId/session
app.delete('/accounts/:accountId/session', async (req, res) => {
  try {
    const accountId = validateId(req.params.accountId, { field: 'accountId' });
    await deleteSession(accountId);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// GET /accounts/:accountId/limits
app.get('/accounts/:accountId/limits', async (req, res) => {
  try {
    const accountId = validateId(req.params.accountId, { field: 'accountId' });
    const limits = await getLimits(accountId);
    res.json(limits);
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// ── Job helper (local only — NOT exported) ────────────────────────────────────

async function runJob(name, data, timeoutMs = 120_000) {
  const accountId   = data.accountId || 'default';
  const queue       = getQueue(accountId);
  const queueEvents = getQueueEvents(accountId);
  
  // Deterministic jobId deduplicates the same job within a 30-second window.
  // BullMQ silently drops adds with a jobId that already exists in the queue.
  const jobId = `${name}:${accountId}:${Math.floor(Date.now() / 30_000)}`;
  
  const job = await queue.add(name, data, {
    jobId,
    // Bounded job retention so Redis doesn't accumulate gigabytes of job history.
    removeOnComplete: { count: 50 },
    removeOnFail:     { count: 100 },
    // Retry once with exponential backoff (5 s, then 10 s).
    attempts: 2,
    backoff:  { type: 'exponential', delay: 5000 },
  });

  try {
    return await job.waitUntilFinished(queueEvents, timeoutMs);
  } catch (err) {
    if (err.message && err.message.includes('timed out')) {
      await job.remove().catch(() => {});
      const toErr    = new Error(`Job ${name} timed out after ${timeoutMs}ms`);
      toErr.status   = 504;
      throw toErr;
    }
    const failErr  = new Error(job.failedReason || err.message || 'Job failed');
    failErr.code   = job.data?.code;
    failErr.status = job.data?.status || 500;
    throw failErr;
  }
}

// ── LinkedIn action endpoints ─────────────────────────────────────────────────

app.post('/accounts/:accountId/verify', async (req, res) => {
  try {
    const result = await runJob('verifySession', {
      accountId: req.params.accountId,
      proxyUrl:  process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: process.env.NODE_ENV === 'production' ? 'Operation failed' : err.message,
      code: err.code,
    });
  }
});

app.get('/messages/inbox', async (req, res) => {
  try {
    const accountId = validateId(req.query.accountId, { field: 'accountId' });
    const limit     = parseLimit(req.query.limit, 20);
    const result    = await runJob('readMessages', {
      accountId, limit, proxyUrl: process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: process.env.NODE_ENV === 'production' ? 'Operation failed' : err.message,
      code: err.code,
    });
  }
});

// GET /messages/thread — Query thread messages from database
app.get('/messages/thread', async (req, res) => {
  try {
    const messageRepo = require('./db/repositories/MessageRepository');
    const accountId = validateId(req.query.accountId, { field: 'accountId' });
    const chatId    = validateId(req.query.chatId,    { field: 'chatId' });
    const limit     = parseLimit(req.query.limit, 100);
    const offset    = parseInt(req.query.offset) || 0;

    // Query messages from database
    const messages = await messageRepo.getMessagesByConversation(chatId, limit, offset);

    // Transform to match expected frontend format
    const result = {
      items: messages.map(msg => ({
        id: msg.id,
        text: msg.text,
        sentAt: new Date(msg.sentAt).getTime(),
        sentByMe: msg.isSentByMe,
        senderName: msg.senderName,
      })),
      cursor: null,
      hasMore: messages.length === limit, // If we got a full page, there might be more
    };

    res.json(result);
  } catch (err) {
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: process.env.NODE_ENV === 'production' ? 'Operation failed' : err.message,
      code: err.code,
    });
  }
});

app.post('/messages/send', async (req, res) => {
  try {
    const accountId = validateId(req.body?.accountId, { field: 'accountId' });
    const chatId    = validateId(req.body?.chatId,    { field: 'chatId' });
    const text      = sanitizeText(req.body?.text, { maxLength: 3000 });
    if (!text) return res.status(400).json({ error: 'text is required' });

    const result = await runJob('sendMessage', {
      accountId, chatId, text, proxyUrl: process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: process.env.NODE_ENV === 'production' ? 'Operation failed' : err.message,
      code: err.code,
    });
  }
});

app.post('/messages/send-new', async (req, res) => {
  try {
    const accountId  = validateId(req.body?.accountId, { field: 'accountId' });
    const profileUrl = validateProfileUrl(req.body?.profileUrl);
    const text       = sanitizeText(req.body?.text, { maxLength: 3000 });
    if (!text) return res.status(400).json({ error: 'text is required' });

    const result = await runJob('sendMessageNew', {
      accountId, profileUrl, text, proxyUrl: process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: process.env.NODE_ENV === 'production' ? 'Operation failed' : err.message,
      code: err.code,
    });
  }
});

app.post('/connections/send', async (req, res) => {
  try {
    const accountId  = validateId(req.body?.accountId, { field: 'accountId' });
    const profileUrl = validateProfileUrl(req.body?.profileUrl);
    const note       = req.body?.note == null ? '' : sanitizeNote(req.body.note);

    const result = await runJob('sendConnectionRequest', {
      accountId, profileUrl, note, proxyUrl: process.env.PROXY_URL || null,
    }, 90000); // shorter timeout: 90s
    res.json(result);
  } catch (err) {
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: process.env.NODE_ENV === 'production' ? 'Operation failed' : err.message,
      code: err.code,
    });
  }
});

// GET /inbox/unified — Query conversations from database (all accounts)
app.get('/inbox/unified', async (req, res) => {
  try {
    const messageRepo = require('./db/repositories/MessageRepository');
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    // Query all conversations from database
    const conversations = await messageRepo.getAllConversations(limit, offset);

    // Transform to match expected frontend format
    const payload = {
      conversations: conversations.map(conv => ({
        conversationId: conv.id,
        accountId: conv.accountId,
        participant: {
          name: conv.participantName,
          profileUrl: conv.participantProfileUrl || '',
        },
        lastMessage: {
          text: conv.lastMessageText,
          sentAt: new Date(conv.lastMessageAt).getTime(),
          sentByMe: conv.lastMessageSentByMe,
        },
        unreadCount: 0, // We don't track unread in database yet
        messages: [],
      })),
    };

    res.json(payload);
  } catch (err) {
    console.error('[API] Error fetching unified inbox:', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// !! IMPORTANT: /stats/all/summary MUST be declared BEFORE /stats/:accountId/summary
// Express matches top-down; 'all' would be captured as accountId parameter otherwise

app.get('/stats/all/summary', async (_req, res) => {
  try {
    const ids   = (process.env.ACCOUNT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const redis = getRedis();

    let totalMessages    = 0;
    let totalConnections = 0;

    const accountStats = await Promise.all(
      ids.map(async (id) => {
        const [msgs, conns] = await Promise.all([
          redis.get(`stats:messages:${id}`).catch(() => '0'),
          redis.get(`stats:connections:${id}`).catch(() => '0'),
        ]);
        const parsedMsgs  = parseInt(msgs  || '0', 10);
        const parsedConns = parseInt(conns || '0', 10);
        totalMessages    += parsedMsgs;
        totalConnections += parsedConns;
        return { id, totalActivity: parsedMsgs + parsedConns };
      })
    );

    res.json({
      accounts: Object.fromEntries(accountStats.map(a => [a.id, a])),
      totalMessages,
      totalConnections,
    });
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

app.get('/stats/:accountId/summary', async (req, res) => {
  try {
    const { accountId } = req.params;
    const redis = getRedis();
    const key   = `activity:log:${accountId}`;
    const total = await redis.llen(key).catch(() => 0);
    res.json({ accountId, totalActivity: total });
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

app.get('/stats/:accountId/activity', async (req, res) => {
  try {
    const accountId = validateId(req.params.accountId, { field: 'accountId' });
    const page  = parseInt(req.query.page  ?? '0',  10);
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const redis = getRedis();
    const key   = `activity:log:${accountId}`;
    const total = await redis.llen(key);
    const start = page * limit;
    const stop  = start + limit - 1;
    const raw   = await redis.lrange(key, start, stop);

    const entries = raw.map(r => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);

    res.json({ entries, total });
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

app.get('/people/search', async (req, res) => {
  try {
    const accountId = validateId(req.query.accountId, { field: 'accountId' });
    const { limit } = req.query;
    const q = sanitizeText(req.query.q, { maxLength: 200 });
    if (!q) return res.status(400).json({ error: 'q is required' });

    const result = await runJob('searchPeople', {
      accountId, query: q, limit: parseInt(limit || '10', 10),
      proxyUrl: process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Operation failed' : err.message, code: err.code });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const http = require('http');
const { initializeWebSocket } = require('./utils/websocket');

startWorker();

// Create HTTP server and attach Socket.IO
const server = http.createServer(app);
initializeWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] Worker API listening on port ${PORT}`);
  console.log(`[WebSocket] WebSocket server ready on port ${PORT}`);
});
