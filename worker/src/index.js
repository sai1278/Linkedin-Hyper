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

app.use(express.json({ limit: '2mb' }));

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
    const { accountId } = req.params;
    const cookies = req.body;
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).json({ error: 'Body must be a non-empty array of cookies' });
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
    const meta = await sessionMeta(req.params.accountId);
    if (!meta) return res.status(404).json({ exists: false });
    res.json({ exists: true, ...meta });
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// DELETE /accounts/:accountId/session
app.delete('/accounts/:accountId/session', async (req, res) => {
  try {
    await deleteSession(req.params.accountId);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// GET /accounts/:accountId/limits
app.get('/accounts/:accountId/limits', async (req, res) => {
  try {
    const limits = await getLimits(req.params.accountId);
    res.json(limits);
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// ── Job helper (local only — NOT exported) ────────────────────────────────────

async function runJob(name, data, timeoutMs = 300000) {
  const queue       = getQueue();
  const queueEvents = getQueueEvents();
  const jobId       = uuidv4();
  const job         = await queue.add(name, data, { jobId });

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

app.get('/messages/thread', async (req, res) => {
  try {
    const accountId = validateId(req.query.accountId, { field: 'accountId' });
    const chatId    = validateId(req.query.chatId,    { field: 'chatId' });
    const limit     = parseLimit(req.query.limit, 50);
    const result    = await runJob('readThread', {
      accountId, chatId, limit, proxyUrl: process.env.PROXY_URL || null,
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

// GET /inbox/unified — triggers parallel inbox reads for all active accounts
app.get('/inbox/unified', async (req, res) => {
  try {
    const ids   = (process.env.ACCOUNT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const redis = getRedis();

    const results = await Promise.allSettled(
      ids.map(async (accountId) => {
        const metaRaw = await redis.get(`session:meta:${accountId}`);
        if (!metaRaw) return []; // skip accounts with no active session

        const result = await runJob('readMessages', {
          accountId, limit: 20, proxyUrl: process.env.PROXY_URL || null,
        }, 120000);

        const items = result?.items ?? [];
        return items.map((chat) => ({
          conversationId: chat.id,
          accountId,
          participant: {
            name:       chat.participants?.[0]?.name       ?? 'Unknown',
            profileUrl: chat.participants?.[0]?.profileUrl ?? '',
          },
          lastMessage: {
            text:     chat.lastMessage?.text ?? '',
            sentAt:   chat.lastMessage?.createdAt
              ? new Date(chat.lastMessage.createdAt).getTime()
              : Date.now(),
            sentByMe: chat.lastMessage?.senderId === '__self__',
          },
          unreadCount: chat.unreadCount ?? 0,
          messages: [],
        }));
      })
    );

    const all = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .sort((a, b) => (b.lastMessage?.sentAt ?? 0) - (a.lastMessage?.sentAt ?? 0));

    res.json({ conversations: all });
  } catch (err) {
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
    const limit = parseInt(req.query.limit ?? '50', 10);
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
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'q is required' });

    const result = await runJob('searchPeople', {
      accountId, query: q, limit: parseInt(limit || '10', 10),
      proxyUrl: process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

startWorker();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] Worker API listening on port ${PORT}`);
});
