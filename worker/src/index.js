'use strict';

const express    = require('express');
const crypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getQueue }   = require('./queue');
const { startWorker }  = require('./worker');
const { saveCookies, loadCookies, sessionMeta, deleteSession } = require('./session');
const { getLimits }    = require('./rateLimit');

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

  // Constant-time comparison to prevent timing attacks
  if (
    provided.length !== secret.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── All routes below require API key ─────────────────────────────────────────

app.use(requireApiKey);

// ── Session management ───────────────────────────────────────────────────────

/**
 * POST /accounts/:accountId/session
 * Body: array of cookie objects exported from browser
 * Import cookies for an account (call this once after manual LinkedIn login).
 */
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /accounts/:accountId/session/status
 * Returns session existence and age.
 */
app.get('/accounts/:accountId/session/status', async (req, res) => {
  try {
    const meta = await sessionMeta(req.params.accountId);
    if (!meta) return res.status(404).json({ exists: false });
    res.json({ exists: true, ...meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /accounts/:accountId/session
 * Delete all session data for an account.
 */
app.delete('/accounts/:accountId/session', async (req, res) => {
  try {
    await deleteSession(req.params.accountId);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /accounts/:accountId/limits
 * Returns today's rate limit counters for an account.
 */
app.get('/accounts/:accountId/limits', async (req, res) => {
  try {
    const limits = await getLimits(req.params.accountId);
    res.json(limits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Job helper ───────────────────────────────────────────────────────────────

/**
 * Enqueue a job and wait for its result synchronously (with timeout).
 * The worker is single-concurrency so results are fast for light actions.
 */
async function runJob(name, data, timeoutMs = 120000) {
  const queue = getQueue();
  const jobId = uuidv4();
  const job   = await queue.add(name, data, { jobId });

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await job.getState();

    if (state === 'completed') {
      return await job.returnvalue;
    }

    if (state === 'failed') {
      const err    = new Error(job.failedReason || 'Job failed');
      err.code     = job.data?.code;
      err.status   = job.data?.status || 500;
      throw err;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  await job.remove().catch(() => {});
  const err    = new Error(`Job ${name} timed out after ${timeoutMs}ms`);
  err.status   = 504;
  throw err;
}

// ── LinkedIn action endpoints ─────────────────────────────────────────────────

/**
 * POST /accounts/:accountId/verify
 * Verify the session is alive. Use before other operations.
 */
app.post('/accounts/:accountId/verify', async (req, res) => {
  try {
    const result = await runJob('verifySession', {
      accountId: req.params.accountId,
      proxyUrl:  process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * GET /messages/inbox?accountId=…&limit=20
 * Fetch the inbox conversation list.
 */
app.get('/messages/inbox', async (req, res) => {
  try {
    const { accountId, limit } = req.query;
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const result = await runJob('readMessages', {
      accountId,
      limit:    parseInt(limit || '20', 10),
      proxyUrl: process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * GET /messages/thread?accountId=…&chatId=…&limit=50
 * Fetch messages from a specific conversation.
 */
app.get('/messages/thread', async (req, res) => {
  try {
    const { accountId, chatId, limit } = req.query;
    if (!accountId || !chatId) {
      return res.status(400).json({ error: 'accountId and chatId are required' });
    }

    const result = await runJob('readThread', {
      accountId,
      chatId,
      limit:    parseInt(limit || '50', 10),
      proxyUrl: process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * POST /messages/send
 * Body: { accountId, chatId, text }
 * Send a message in an existing conversation.
 */
app.post('/messages/send', async (req, res) => {
  try {
    const { accountId, chatId, text } = req.body;
    if (!accountId || !chatId || !text) {
      return res.status(400).json({ error: 'accountId, chatId and text are required' });
    }

    const result = await runJob('sendMessage', {
      accountId, chatId, text,
      proxyUrl: process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * POST /messages/send-new
 * Body: { accountId, profileUrl, text }
 * Send a message to a profile (opens new conversation).
 */
app.post('/messages/send-new', async (req, res) => {
  try {
    const { accountId, profileUrl, text } = req.body;
    if (!accountId || !profileUrl || !text) {
      return res.status(400).json({ error: 'accountId, profileUrl and text are required' });
    }

    const result = await runJob('sendMessageNew', {
      accountId, profileUrl, text,
      proxyUrl: process.env.PROXY_URL || null,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * POST /connections/send
 * Body: { accountId, profileUrl, note? }
 * Send a connection request.
 */
app.post('/connections/send', async (req, res) => {
  try {
    const { accountId, profileUrl, note } = req.body;
    if (!accountId || !profileUrl) {
      return res.status(400).json({ error: 'accountId and profileUrl are required' });
    }

    const result = await runJob('sendConnectionRequest', {
      accountId, profileUrl, note,
      proxyUrl: process.env.PROXY_URL || null,
    }, 90000);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * GET /people/search?accountId=…&q=…&limit=10
 * Search for LinkedIn profiles.
 */
app.get('/people/search', async (req, res) => {
  try {
    const { accountId, q, limit } = req.query;
    if (!accountId || !q) {
      return res.status(400).json({ error: 'accountId and q are required' });
    }

    const result = await runJob('searchPeople', {
      accountId,
      query:    q,
      limit:    parseInt(limit || '10', 10),
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
