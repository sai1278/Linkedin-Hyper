'use strict';

const express    = require('express');
const crypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getQueue, getQueueEvents }   = require('./queue');
const { startWorker }  = require('./worker');
const { saveCookies, loadCookies, sessionMeta, deleteSession, listKnownAccountIds } = require('./session');
const { verifySession } = require('./actions/login');
const { readMessages } = require('./actions/readMessages');
const { readThread } = require('./actions/readThread');
const { sendMessage } = require('./actions/sendMessage');
const { sendMessageNew } = require('./actions/sendMessageNew');
const { sendConnectionRequest } = require('./actions/connect');
const { searchPeople } = require('./actions/searchPeople');
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

// Return JSON for malformed request bodies instead of Express HTML error page.
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body. Ensure request payload is valid JSON.' });
  }
  return next(err);
});

// â”€â”€ Global request timeout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Set to 130 s so Express always responds before the BFF AbortSignal (120 s)
// fires, giving the client a meaningful 504 instead of a connection reset.
app.use((req, res, next) => {
  res.setTimeout(130_000, () => {
    if (!res.headersSent) res.status(504).json({ error: 'Request timed out' });
  });
  next();
});

// â”€â”€ Auth middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

function isDatabaseUnavailable(err) {
  if (!err) return false;
  const code = err.code || err?.meta?.code;
  const message = err instanceof Error ? err.message : String(err);
  return (
    code === 'DB_TIMEOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'P1001' ||
    code === 'P2021' || // table does not exist
    code === 'P2022' || // column does not exist
    message.includes('ECONNREFUSED') ||
    message.includes("Can't reach database server") ||
    message.includes('does not exist in the current database')
  );
}

async function withTimeout(promise, timeoutMs, code = 'DB_TIMEOUT') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`Operation timed out after ${timeoutMs}ms`);
      err.code = code;
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function toPublicOperationError(err, fallbackMessage = 'Operation failed') {
  if (process.env.NODE_ENV !== 'production') {
    return err?.message || fallbackMessage;
  }

  // Safe, actionable errors that help operators without exposing sensitive details.
  const safeCodes = new Set([
    'NO_ACTIVE_SESSION',
    'NO_SESSION',
    'SESSION_EXPIRED',
    'NOT_MESSAGEABLE',
    'SEND_NOT_CONFIRMED',
    'RATE_LIMIT_EXCEEDED',
    'QUEUE_UNAVAILABLE',
    'READ_INBOX_TIMEOUT',
  ]);

  if (err?.code && safeCodes.has(err.code) && err?.message) {
    return err.message;
  }

  return fallbackMessage;
}

function normalizeThreadId(accountId, conversationId) {
  const raw = String(conversationId || '');
  const prefix = `${accountId}:`;
  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length);
  }
  return raw;
}

function mapDbMessagesToApiItems(messages) {
  return messages.map((msg) => {
    const createdAt = new Date(msg.sentAt).toISOString();
    const isSentByMe = Boolean(msg.isSentByMe);
    return {
      id: msg.id,
      chatId: msg.conversationId,
      senderId: isSentByMe ? '__self__' : (msg.senderId || 'other'),
      text: msg.text || '',
      createdAt,
      // Compatibility fields for older consumers
      sentAt: createdAt,
      isSentByMe,
      senderName: msg.senderName || (isSentByMe ? msg.accountId : 'Unknown'),
    };
  });
}

function mapLiveMessagesToApiItems(messages, fallbackChatId, accountId) {
  return (messages || []).map((msg, idx) => {
    const createdAt = msg.createdAt || new Date().toISOString();
    const isSentByMe = msg.senderId === '__self__' || msg.isSentByMe === true;
    return {
      id: msg.id || `live-${Date.now()}-${idx}`,
      chatId: msg.chatId || fallbackChatId,
      senderId: isSentByMe ? '__self__' : (msg.senderId || 'other'),
      text: msg.text || '',
      createdAt,
      // Compatibility fields for older consumers
      sentAt: createdAt,
      isSentByMe,
      senderName:
        msg.senderName || (isSentByMe ? accountId : 'Unknown'),
    };
  });
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isGenericUiLabel(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return true;

  if (/^\d+$/.test(normalized)) return true;
  if (/^\d+\s*(notification|notifications|message|messages)(\s+total)?$/.test(normalized)) return true;
  if (/^(notification|notifications|message|messages)\s+total$/.test(normalized)) return true;

  const blocked = [
    'unknown',
    'inbox',
    'messages',
    'activity',
    'notifications',
    'notifications total',
    'loading',
    'linkedin',
    'feed',
    'search',
  ];
  return blocked.includes(normalized);
}

function deriveNameFromProfileUrl(profileUrl) {
  const match = String(profileUrl || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match?.[1]) return '';

  return normalizeWhitespace(
    decodeURIComponent(match[1])
      .replace(/[-_]+/g, ' ')
      .replace(/\b\d+\b/g, '')
  );
}

function normalizeParticipantName(name, profileUrl) {
  const parsedName = normalizeWhitespace(name);
  if (parsedName && !isGenericUiLabel(parsedName)) {
    return parsedName;
  }
  return deriveNameFromProfileUrl(profileUrl) || 'Unknown';
}

// â”€â”€ Health (no auth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function buildUnifiedInboxFromActivity(limit = 100) {
  const ids = await listKnownAccountIds();
  const redis = getRedis();
  const latestByConversation = new Map();

  for (const accountId of ids) {
    let entries = [];
    try {
      entries = await redis.lrange(`activity:log:${accountId}`, 0, 500);
    } catch {
      continue;
    }

    for (const raw of entries) {
      try {
        const item = JSON.parse(raw);
        if (item?.type !== 'messageSent') continue;

        const participantProfileUrl = String(item.targetProfileUrl || '');
        const participantName = normalizeParticipantName(item.targetName, participantProfileUrl);
        const sentAt = Number(item.timestamp) || Date.now();
        const textPreview = typeof item.textPreview === 'string' && item.textPreview.length > 0
          ? item.textPreview
          : `Sent message (${Number(item.messageLength) || 0} chars)`;

        const key = `${accountId}|${participantName}|${participantProfileUrl}`;
        const previous = latestByConversation.get(key);
        if (previous && previous.lastMessage?.sentAt >= sentAt) continue;

        latestByConversation.set(key, {
          conversationId: `activity-${Buffer.from(key).toString('base64url')}`,
          accountId,
          participant: {
            name: participantName,
            profileUrl: participantProfileUrl,
          },
          lastMessage: {
            text: textPreview,
            sentAt,
            sentByMe: true,
          },
          unreadCount: 0,
          messages: [
            {
              id: `activity-msg-${sentAt}`,
              text: textPreview,
              sentAt,
              sentByMe: true,
              senderName: accountId,
            },
          ],
        });
      } catch {
        // Ignore malformed activity rows.
      }
    }
  }

  const conversations = Array.from(latestByConversation.values())
    .sort((a, b) => (b.lastMessage?.sentAt || 0) - (a.lastMessage?.sentAt || 0))
    .slice(0, limit);

  return { conversations };
}

const UNIFIED_INBOX_CACHE_TTL_MS = 60_000;
let unifiedInboxCache = {
  expiresAt: 0,
  payload: { conversations: [] },
};
let unifiedInboxInFlight = null;

function normalizeConversationFromInboxItem(accountId, item) {
  const participantProfileUrl = String(item?.participants?.[0]?.profileUrl || '');
  const participantName = normalizeParticipantName(item?.participants?.[0]?.name, participantProfileUrl);
  const rawId = String(item?.id || `unknown-${Date.now()}`);
  const createdAt = item?.lastMessage?.createdAt || item?.createdAt || new Date().toISOString();
  const sentAt = Number(new Date(createdAt).getTime()) || Date.now();

  return {
    conversationId: `${accountId}:${rawId}`,
    accountId,
    participant: {
      name: participantName,
      profileUrl: participantProfileUrl,
    },
    lastMessage: {
      text: String(item?.lastMessage?.text || ''),
      sentAt,
      sentByMe: item?.lastMessage?.senderId === '__self__',
    },
    unreadCount: Number(item?.unreadCount) || 0,
    messages: [],
  };
}

function dedupeAndSortConversations(conversations) {
  const latestByConversation = new Map();

  for (const conv of conversations) {
    if (!conv?.accountId) continue;
    const key = `${conv.accountId}|${conv.participant?.name || ''}|${conv.participant?.profileUrl || ''}`;
    const previous = latestByConversation.get(key);
    const currentSentAt = Number(conv?.lastMessage?.sentAt) || 0;
    const previousSentAt = Number(previous?.lastMessage?.sentAt) || 0;
    if (!previous || currentSentAt >= previousSentAt) {
      latestByConversation.set(key, conv);
    }
  }

  return Array.from(latestByConversation.values()).sort(
    (a, b) => (Number(b?.lastMessage?.sentAt) || 0) - (Number(a?.lastMessage?.sentAt) || 0)
  );
}

async function buildUnifiedInboxFromLive(limit = 100) {
  const ids = await listKnownAccountIds();
  const proxyUrl = process.env.PROXY_URL || null;
  const perAccountLimit = Math.max(10, Math.ceil(limit / Math.max(ids.length, 1)) * 2);
  const conversations = [];
  const sessionFailures = [];

  for (const accountId of ids) {
    try {
      const inbox = await withTimeout(
        readMessages({ accountId, limit: perAccountLimit, proxyUrl }),
        30_000,
        'READ_INBOX_TIMEOUT'
      );
      for (const item of inbox?.items || []) {
        conversations.push(normalizeConversationFromInboxItem(accountId, item));
      }
    } catch (err) {
      const code = err?.code;
      if (code === 'NO_SESSION' || code === 'SESSION_EXPIRED') {
        sessionFailures.push({ accountId, code });
      } else if (code !== 'READ_INBOX_TIMEOUT') {
        console.warn(`[Inbox] Live read failed for ${accountId}:`, err?.message || String(err));
      }
    }
  }

  return {
    conversations: dedupeAndSortConversations(conversations).slice(0, limit),
    sessionFailures,
    attemptedAccounts: ids.length,
  };
}

async function buildUnifiedInboxWithFallback(limit = 100) {
  const now = Date.now();
  if (unifiedInboxCache.expiresAt > now) {
    return { conversations: unifiedInboxCache.payload.conversations.slice(0, limit) };
  }

  if (unifiedInboxInFlight) {
    const payload = await unifiedInboxInFlight;
    return { conversations: payload.conversations.slice(0, limit) };
  }

  unifiedInboxInFlight = (async () => {
    const activityPayload = await buildUnifiedInboxFromActivity(limit);
    let combined = activityPayload.conversations;
    let liveMeta = { sessionFailures: [], attemptedAccounts: 0 };

    if (combined.length < limit) {
      const livePayload = await buildUnifiedInboxFromLive(limit);
      liveMeta = {
        sessionFailures: livePayload.sessionFailures || [],
        attemptedAccounts: livePayload.attemptedAccounts || 0,
      };
      combined = dedupeAndSortConversations([...combined, ...livePayload.conversations]);
    } else {
      combined = dedupeAndSortConversations(combined);
    }

    if (
      combined.length === 0 &&
      liveMeta.attemptedAccounts > 0 &&
      liveMeta.sessionFailures.length === liveMeta.attemptedAccounts
    ) {
      const err = new Error('All LinkedIn sessions are missing or expired. Re-import cookies for each account.');
      err.status = 401;
      err.code = 'NO_ACTIVE_SESSION';
      throw err;
    }

    const payload = { conversations: combined.slice(0, limit) };
    unifiedInboxCache = {
      expiresAt: Date.now() + UNIFIED_INBOX_CACHE_TTL_MS,
      payload,
    };
    return payload;
  })();

  try {
    const payload = await unifiedInboxInFlight;
    return { conversations: payload.conversations.slice(0, limit) };
  } finally {
    unifiedInboxInFlight = null;
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// â”€â”€ All routes below require API key â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.use(requireApiKey);

const { getRedis } = require('./redisClient');
const { cleanupContext } = require('./browser');
const accountRepo = require('./db/repositories/AccountRepository');
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
    const ids = new Set(await listKnownAccountIds());

    try {
      const dbAccounts = await withTimeout(accountRepo.getAllAccounts(), 4000);
      for (const acc of dbAccounts) {
        if (acc?.id) ids.add(acc.id);
      }
    } catch (dbErr) {
      if (!isDatabaseUnavailable(dbErr)) {
        console.warn('[Accounts] Could not read account list from database:', dbErr.message);
      }
    }

    const accounts = await Promise.all(
      Array.from(ids).sort((a, b) => a.localeCompare(b)).map(async (id) => {
        const meta = await sessionMeta(id).catch(() => null);
        return {
          id,
          displayName: id,
          isActive: !!meta,
          lastSeen: meta?.savedAt ?? null,
        };
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
    await cleanupContext(accountId).catch(() => {});
    const cookies = req.body;
    if (!Array.isArray(cookies) || cookies.length === 0 || !cookies.every(c => c && typeof c === 'object' && !Array.isArray(c))) {
      return res.status(400).json({ error: 'Body must be a non-empty array of valid cookie objects' });
    }
    await saveCookies(accountId, cookies);
    try {
      await withTimeout(accountRepo.upsertAccount(accountId, accountId), 4000);
    } catch (dbErr) {
      if (!isDatabaseUnavailable(dbErr)) {
        console.warn('[Session Import] Failed to upsert account in database:', dbErr.message);
      }
    }
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
    await cleanupContext(accountId).catch(() => {});
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

// â”€â”€ Job helper (local only â€” NOT exported) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function runJob(name, data, timeoutMs = 120_000) {
  const runDirectly = process.env.DIRECT_EXECUTION === '1' || process.env.DISABLE_QUEUE === '1';
  if (runDirectly) {
    return runDirectJob(name, data);
  }

  const accountId   = data.accountId || 'default';
  const queue       = getQueue(accountId);
  const queueEvents = getQueueEvents(accountId);
  const nonIdempotentJobs = new Set(['sendMessage', 'sendMessageNew', 'sendConnectionRequest']);

  const toQueueUnavailableError = (originalErr) => {
    const msg = originalErr instanceof Error ? originalErr.message : String(originalErr);
    const err = new Error('Background queue unavailable. Start Redis and retry.');
    err.status = 503;
    err.code = 'QUEUE_UNAVAILABLE';
    err.cause = msg;
    return err;
  };

  const isQueueConnectivityError = (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes('Connection is closed') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('getaddrinfo')
    );
  };
  
  // Deterministic jobId deduplicates the same job within a 30-second window.
  // BullMQ silently drops adds with a jobId that already exists in the queue.
  const jobId = `${name}:${accountId}:${Math.floor(Date.now() / 30_000)}`;

  let job;
  try {
    const retryOptions = nonIdempotentJobs.has(name)
      ? { attempts: 1 }
      : {
          // Retry once with exponential backoff (5 s, then 10 s).
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
        };

    job = await queue.add(name, data, {
      jobId,
      // Bounded job retention so Redis doesn't accumulate gigabytes of job history.
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
      ...retryOptions,
    });
  } catch (err) {
    if (isQueueConnectivityError(err)) throw toQueueUnavailableError(err);
    throw err;
  }

  try {
    return await job.waitUntilFinished(queueEvents, timeoutMs);
  } catch (err) {
    if (isQueueConnectivityError(err)) throw toQueueUnavailableError(err);

    if (err.message && err.message.includes('timed out')) {
      await job.remove().catch(() => {});
      const toErr    = new Error(`Job ${name} timed out after ${timeoutMs}ms`);
      toErr.status   = 504;
      throw toErr;
    }
    const reason = String(job.failedReason || err?.message || 'Job failed');
    const lowerReason = reason.toLowerCase();
    const failErr  = new Error(reason);

    // Preserve explicit codes if available.
    failErr.code = err?.code || job?.failedReasonCode || undefined;
    failErr.status = err?.status || 500;

    // BullMQ often stores only failedReason (message string), so infer safe codes.
    if (!failErr.code) {
      if (reason.includes('Session expired for account')) {
        failErr.code = 'SESSION_EXPIRED';
        failErr.status = 401;
      } else if (reason.includes('No session for account')) {
        failErr.code = 'NO_SESSION';
        failErr.status = 401;
      } else if (reason.includes('All LinkedIn sessions are missing or expired')) {
        failErr.code = 'NO_ACTIVE_SESSION';
        failErr.status = 401;
      } else if (
        lowerReason.includes('could not open message composer from profile') ||
        lowerReason.includes('not_messageable') ||
        lowerReason.includes('not messageable')
      ) {
        failErr.code = 'NOT_MESSAGEABLE';
        failErr.status = 400;
      } else if (
        reason.includes('Message send could not be confirmed in thread') ||
        reason.includes('Send clicked but LinkedIn thread ID was not resolved') ||
        reason.includes('Message was not found in thread after send confirmation')
      ) {
        failErr.code = 'SEND_NOT_CONFIRMED';
        failErr.status = 502;
      } else if (lowerReason.includes('operation failed')) {
        failErr.code = 'SEND_NOT_CONFIRMED';
        failErr.status = 502;
        failErr.message = 'LinkedIn UI transient failure while sending message. Please retry once with fresh cookies.';
      } else if (reason.includes('Daily limit reached:')) {
        failErr.code = 'RATE_LIMIT_EXCEEDED';
        failErr.status = 429;
      }
    }

    throw failErr;
  }
}

async function runDirectJob(name, data) {
  switch (name) {
    case 'verifySession':
      return verifySession(data);
    case 'readMessages':
      return readMessages(data);
    case 'readThread':
      return readThread(data);
    case 'sendMessage':
      return sendMessage(data);
    case 'sendMessageNew':
      return sendMessageNew(data);
    case 'sendConnectionRequest':
      return sendConnectionRequest(data);
    case 'searchPeople':
      return searchPeople(data);
    case 'messageSync':
      return syncAllAccounts(data.proxyUrl);
    default:
      throw new Error(`Unknown job type: ${name}`);
  }
}

// â”€â”€ LinkedIn action endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.post('/accounts/:accountId/verify', async (req, res) => {
  try {
    const accountId = req.params.accountId;
    const proxyUrl = process.env.PROXY_URL || null;

    // Local dev mode: bypass BullMQ queue so verification can run without Redis.
    const useDirectVerify = process.env.DIRECT_VERIFY === '1' || process.env.DISABLE_MESSAGE_SYNC === '1';
    let result;
    if (useDirectVerify) {
      result = await verifySession({ accountId, proxyUrl });
    } else {
      try {
        result = await runJob('verifySession', { accountId, proxyUrl });
      } catch (queueErr) {
        const msg = queueErr instanceof Error ? queueErr.message : String(queueErr);
        const isRedisConnectivityError =
          msg.includes('Connection is closed') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('ENOTFOUND') ||
          msg.includes('getaddrinfo');

        if (!isRedisConnectivityError) throw queueErr;

        console.warn('[Verify] Queue unavailable, falling back to direct verification:', msg);
        result = await verifySession({ accountId, proxyUrl });
      }
    }

    res.json(result);
  } catch (err) {
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: toPublicOperationError(err),
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
      error: toPublicOperationError(err),
      code: err.code,
    });
  }
});

// GET /messages/thread â€” Query thread messages from database
app.get('/messages/thread', async (req, res) => {
  try {
    const messageRepo = require('./db/repositories/MessageRepository');
    const accountId = validateId(req.query.accountId, { field: 'accountId' });
    const chatId    = validateId(req.query.chatId,    { field: 'chatId' });
    const normalizedChatId = normalizeThreadId(accountId, chatId);
    const limit     = parseLimit(req.query.limit, 100);
    const offset    = parseInt(req.query.offset) || 0;
    const proxyUrl  = process.env.PROXY_URL || null;

    let dbMessages = [];
    try {
      dbMessages = await withTimeout(
        messageRepo.getMessagesByConversation(chatId, limit, offset),
        4000
      );

      // Support prefixed IDs from unified fallback (accountId:rawChatId).
      if (dbMessages.length === 0 && normalizedChatId !== chatId) {
        dbMessages = await withTimeout(
          messageRepo.getMessagesByConversation(normalizedChatId, limit, offset),
          4000
        );
      }
    } catch (dbErr) {
      if (!isDatabaseUnavailable(dbErr)) throw dbErr;
    }

    if (dbMessages.length > 0) {
      return res.json({
        items: mapDbMessagesToApiItems(dbMessages),
        cursor: null,
        hasMore: dbMessages.length === limit,
      });
    }

    // Activity-only rows do not map to a concrete LinkedIn thread ID.
    // Return pseudo thread messages from recent activity log so UI is not blank.
    if (normalizedChatId.startsWith('activity-')) {
      try {
        const encodedKey = normalizedChatId.slice('activity-'.length);
        const decodedKey = Buffer.from(encodedKey, 'base64url').toString('utf8');
        const decodedParts = decodedKey.split('|');
        decodedParts.shift(); // accountId from key
        const participantNameRaw = decodedParts.shift() || '';
        const participantProfileRaw = decodedParts.join('|');
        const participantName = normalizeParticipantName(participantNameRaw, participantProfileRaw);
        const participantProfileUrl = String(participantProfileRaw || '');

        const redis = getRedis();
        const rawActivity = await redis.lrange(`activity:log:${accountId}`, 0, 500);
        const activityMessages = [];

        for (const rawEntry of rawActivity) {
          try {
            const entry = JSON.parse(rawEntry);
            if (entry?.type !== 'messageSent') continue;

            const entryProfile = String(entry.targetProfileUrl || '');
            const entryName = normalizeParticipantName(entry.targetName, entryProfile);
            const sameParticipant =
              (participantProfileUrl && entryProfile === participantProfileUrl) ||
              entryName === participantName;

            if (!sameParticipant) continue;

            const timestamp = Number(entry.timestamp) || Date.now();
            const text = typeof entry.textPreview === 'string' && entry.textPreview.trim()
              ? entry.textPreview.trim()
              : `Sent message (${Number(entry.messageLength) || 0} chars)`;

            activityMessages.push({
              id: `activity-msg-${timestamp}-${activityMessages.length}`,
              chatId: normalizedChatId,
              senderId: '__self__',
              text,
              createdAt: new Date(timestamp).toISOString(),
              senderName: accountId,
            });
          } catch {
            // Ignore malformed activity entries.
          }
        }

        activityMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        return res.json({
          items: activityMessages.slice(-limit),
          cursor: null,
          hasMore: false,
        });
      } catch {
        return res.json({ items: [], cursor: null, hasMore: false });
      }
    }

    // Live fallback: fetch directly from LinkedIn when DB thread is empty.
    let liveThread;
    try {
      liveThread = await runJob('readThread', {
        accountId,
        chatId: normalizedChatId,
        proxyUrl,
        limit,
      });
    } catch (queueErr) {
      const msg = queueErr instanceof Error ? queueErr.message : String(queueErr);
      const isQueueConnectivityError =
        msg.includes('Connection is closed') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('getaddrinfo');

      if (!isQueueConnectivityError) throw queueErr;
      console.warn('[Thread] Queue unavailable, falling back to direct readThread:', msg);
      liveThread = await readThread({ accountId, chatId: normalizedChatId, proxyUrl, limit });
    }

    const liveItems = mapLiveMessagesToApiItems(liveThread?.items, normalizedChatId, accountId);

    // Best-effort persistence so next load comes from DB.
    if (liveItems.length > 0) {
      try {
        const participantName =
          (liveThread?.participant?.name && liveThread.participant.name !== 'Unknown')
            ? liveThread.participant.name
            : (liveItems.find((m) => m.senderId !== '__self__' && m.senderName !== 'Unknown')?.senderName || 'Unknown');
        const participantProfileUrl = liveThread?.participant?.profileUrl || null;
        const latestLive = liveItems[liveItems.length - 1];

        await withTimeout(messageRepo.upsertConversation({
          id: normalizedChatId,
          accountId,
          participantName,
          participantProfileUrl,
          participantAvatarUrl: null,
          lastMessageAt: new Date(latestLive.createdAt),
          lastMessageText: latestLive.text || '',
          lastMessageSentByMe: latestLive.senderId === '__self__',
        }), 4000);

        for (const item of liveItems) {
          await withTimeout(messageRepo.upsertMessage({
            conversationId: normalizedChatId,
            accountId,
            senderId: item.senderId,
            senderName: item.senderName,
            text: item.text,
            sentAt: item.createdAt,
            isSentByMe: item.senderId === '__self__',
            linkedinMessageId: item.id,
          }), 4000);
        }
      } catch (persistErr) {
        if (!isDatabaseUnavailable(persistErr)) {
          console.warn('[Thread] Live fallback persistence failed:', persistErr.message || String(persistErr));
        }
      }
    }

    return res.json({
      items: liveItems,
      cursor: liveThread?.cursor || null,
      hasMore: Boolean(liveThread?.hasMore),
    });
  } catch (err) {
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: toPublicOperationError(err),
      code: err.code,
    });
  }
});

app.post('/messages/send', async (req, res) => {
  try {
    const accountId = validateId(req.body?.accountId, { field: 'accountId' });
    const chatId    = validateId(req.body?.chatId,    { field: 'chatId' });
    const normalizedChatId = normalizeThreadId(accountId, chatId);
    const text      = sanitizeText(req.body?.text, { maxLength: 3000 });
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (normalizedChatId.startsWith('activity-')) {
      return res.status(400).json({
        error: 'This conversation is activity-only and cannot be replied yet. Run sync and retry.',
        code: 'THREAD_NOT_REPLYABLE',
      });
    }

    const result = await runJob('sendMessage', {
      accountId, chatId: normalizedChatId, text, proxyUrl: process.env.PROXY_URL || null,
    });
    if (!res.headersSent) {
      res.json(result);
    }
  } catch (err) {
    if (res.headersSent) return;
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: toPublicOperationError(err),
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
    if (!res.headersSent) {
      res.json(result);
    }
  } catch (err) {
    if (res.headersSent) return;
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: toPublicOperationError(err),
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
      error: toPublicOperationError(err),
      code: err.code,
    });
  }
});

// GET /inbox/unified â€” Query conversations from database (all accounts)
app.get('/inbox/unified', async (req, res) => {
  try {
    const messageRepo = require('./db/repositories/MessageRepository');
    const limit = parseLimit(req.query.limit, 100, 200);
    const offset = parseInt(req.query.offset) || 0;

    // Query all conversations from database
    const conversations = await withTimeout(
      messageRepo.getAllConversations(limit, offset),
      4000
    );

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

    if (payload.conversations.length === 0) {
      const livePayload = await buildUnifiedInboxWithFallback(limit);
      return res.json(livePayload);
    }

    res.json(payload);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      try {
        const livePayload = await buildUnifiedInboxWithFallback(parseLimit(req.query.limit, 100, 200));
        return res.json(livePayload);
      } catch (fallbackErr) {
        if (fallbackErr?.status) {
          return res.status(fallbackErr.status).json({
            error: toPublicOperationError(fallbackErr),
            code: fallbackErr.code,
          });
        }
        console.error('[API] Error in fallback unified inbox:', fallbackErr);
        return res.status(500).json({
          error: process.env.NODE_ENV === 'production' ? 'Internal error' : fallbackErr.message,
        });
      }
    }

    if (err?.status) {
      return res.status(err.status).json({
        error: toPublicOperationError(err),
        code: err.code,
      });
    }

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
    const total = await redis.llen(key).catch(() => 0);
    const start = page * limit;
    const stop  = start + limit - 1;
    const raw   = await redis.lrange(key, start, stop).catch(() => []);

    const entries = raw.map(r => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean).map((entry) => {
      const profileUrl = String(entry.targetProfileUrl || '');
      return {
        ...entry,
        targetName: normalizeParticipantName(entry.targetName, profileUrl),
      };
    });

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
    res.status(err.status || 500).json({ error: toPublicOperationError(err), code: err.code });
  }
});

// â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


