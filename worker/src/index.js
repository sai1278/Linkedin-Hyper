'use strict';

const express    = require('express');
const crypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getQueue, getQueueEvents }   = require('./queue');
const { startWorker }  = require('./worker');
const {
  saveCookies,
  loadCookies,
  sessionMeta,
  deleteSession,
  listKnownAccountIds,
  hasRequiredLinkedInSessionCookies,
} = require('./session');
const { verifySession } = require('./actions/login');
const { readMessages } = require('./actions/readMessages');
const { readConnections } = require('./actions/readConnections');
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
    'CHECKPOINT_INCOMPLETE',
    'LOGIN_NOT_FINISHED',
    'COOKIES_MISSING',
    'AUTHENTICATED_STATE_NOT_REACHED',
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

function normalizeProfileUrlForCompare(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    parsed.hash = '';
    parsed.search = '';
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = normalizedPath || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(url || '').trim().replace(/\/+$/, '');
  }
}

function normalizeActivityToken(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function buildActivityDedupKey(entry) {
  const profileUrl = normalizeProfileUrlForCompare(entry?.targetProfileUrl || '');
  const participantName = normalizeParticipantName(entry?.targetName, profileUrl);
  const targetIdentity = profileUrl || normalizeActivityToken(participantName);
  const messageIdentity = normalizeActivityToken(entry?.message || entry?.textPreview || '');
  return [
    normalizeActivityToken(entry?.type || 'activity'),
    normalizeActivityToken(entry?.accountId || ''),
    targetIdentity,
    messageIdentity,
  ].join('|');
}

function dedupeRecentActivity(entries, windowMs = 10 * 60 * 1000) {
  const sorted = [...(entries || [])].sort(
    (a, b) => (Number(b?.timestamp) || 0) - (Number(a?.timestamp) || 0)
  );

  const latestSeenByKey = new Map();
  const deduped = [];

  for (const entry of sorted) {
    const timestamp = Number(entry?.timestamp) || 0;
    const key = buildActivityDedupKey(entry);
    const previousTs = latestSeenByKey.get(key);

    if (typeof previousTs === 'number' && previousTs - timestamp <= windowMs) {
      continue;
    }

    latestSeenByKey.set(key, timestamp);
    deduped.push(entry);
  }

  return deduped;
}

async function getRecentActivityEntries(accountId, limit = 500) {
  const redis = getRedis();

  try {
    const rows = await redis.lrange(`activity:log:${accountId}`, 0, limit);
    return rows
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function deriveHealthSeverity({ hasSession, sessionIssue, lastSyncStatus, lastSyncedAt, staleThresholdMs }) {
  if (!hasSession) return 'critical';
  if (sessionIssue) return 'critical';
  if (lastSyncStatus === 'failed') return 'critical';
  if (lastSyncStatus === 'warning') return 'warning';
  if (lastSyncStatus === 'running') return 'warning';
  if (lastSyncedAt && Date.now() - lastSyncedAt > staleThresholdMs) return 'warning';
  return 'healthy';
}

async function buildHealthSummary() {
  const syncIntervalMinutes = Math.max(1, parseInt(process.env.SYNC_INTERVAL_MINUTES || '10', 10) || 10);
  const staleThresholdMs = syncIntervalMinutes * 60_000 * 3;
  const healthState = getHealthStateSnapshot();
  const knownIds = Array.from(await getKnownAccountIdsSet()).sort((a, b) => a.localeCompare(b));

  let dbAccounts = [];
  try {
    dbAccounts = await withTimeout(accountRepo.getAllAccounts(), 4000);
  } catch (err) {
    if (!isDatabaseUnavailable(err)) {
      throw err;
    }
  }

  const dbAccountsById = new Map(
    (dbAccounts || []).map((account) => [String(account?.id || '').trim(), account])
  );

  const accounts = await Promise.all(
    knownIds.map(async (accountId) => {
      const meta = await sessionMeta(accountId).catch(() => null);
      const state = healthState.accounts[accountId] || {};
      const dbAccount = dbAccountsById.get(accountId);
      const lastSyncedAt = dbAccount?.lastSyncedAt ? new Date(dbAccount.lastSyncedAt).getTime() : null;
      const hasSession = Boolean(meta?.savedAt);
      const severity = deriveHealthSeverity({
        hasSession,
        sessionIssue: state.sessionIssue,
        lastSyncStatus: state.lastSyncStatus,
        lastSyncedAt,
        staleThresholdMs,
      });

      return {
        accountId,
        displayName: String(dbAccount?.displayName || accountId),
        hasSession,
        lastSessionSavedAt: Number(meta?.savedAt) || null,
        sessionAgeSeconds: Number(meta?.ageSeconds) || null,
        lastSyncedAt,
        lastSyncStatus: state.lastSyncStatus || 'idle',
        lastSyncSource: state.lastSyncSource || null,
        lastSyncStartedAt: Number(state.lastSyncStartedAt) || null,
        lastSyncCompletedAt: Number(state.lastSyncCompletedAt) || null,
        lastSyncError: state.lastSyncError || null,
        lastSyncStats: state.lastSyncStats || null,
        sessionIssue: state.sessionIssue || null,
        severity,
      };
    })
  );

  const alerts = [];
  for (const account of accounts) {
    if (!account.hasSession) {
      alerts.push({
        id: `session-missing-${account.accountId}`,
        severity: 'critical',
        kind: 'session',
        accountId: account.accountId,
        title: `${account.displayName}: session missing`,
        message: 'Open Accounts and import fresh LinkedIn cookies before sending or syncing.',
      });
      continue;
    }

    if (account.sessionIssue) {
      alerts.push({
        id: `session-issue-${account.accountId}`,
        severity: 'critical',
        kind: 'session',
        accountId: account.accountId,
        title: `${account.displayName}: session needs attention`,
        message: account.sessionIssue.message,
      });
    }

    if (account.lastSyncStatus === 'failed') {
      alerts.push({
        id: `sync-failed-${account.accountId}`,
        severity: 'critical',
        kind: 'sync',
        accountId: account.accountId,
        title: `${account.displayName}: sync failed`,
        message: account.lastSyncError || 'The latest sync did not complete successfully.',
      });
    } else if (
      account.lastSyncedAt &&
      Date.now() - account.lastSyncedAt > staleThresholdMs
    ) {
      alerts.push({
        id: `sync-stale-${account.accountId}`,
        severity: 'warning',
        kind: 'sync',
        accountId: account.accountId,
        title: `${account.displayName}: sync looks stale`,
        message: `No successful sync recorded in the last ${syncIntervalMinutes * 3} minutes.`,
      });
    }
  }

  const totals = {
    totalAccounts: accounts.length,
    accountsWithSession: accounts.filter((account) => account.hasSession).length,
    accountsNeedingAttention: accounts.filter((account) => account.severity !== 'healthy').length,
    criticalAlerts: alerts.filter((alert) => alert.severity === 'critical').length,
    warningAlerts: alerts.filter((alert) => alert.severity === 'warning').length,
  };

  return {
    status: totals.criticalAlerts > 0 ? 'critical' : totals.warningAlerts > 0 ? 'warning' : 'healthy',
    generatedAt: Date.now(),
    syncIntervalMinutes,
    totals,
    alerts,
    accounts,
    bulkSync: healthState.bulkSync,
  };
}

async function buildStartupValidationReport() {
  const checks = [];
  const redis = getRedis();

  try {
    const result = await withTimeout(redis.ping(), 2000, 'REDIS_TIMEOUT');
    checks.push({
      id: 'redis',
      label: 'Redis connectivity',
      status: String(result).toUpperCase() === 'PONG' ? 'pass' : 'fail',
      detail: String(result),
    });
  } catch (err) {
    checks.push({
      id: 'redis',
      label: 'Redis connectivity',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const dbAccounts = await withTimeout(accountRepo.getAllAccounts(), 4000);
    checks.push({
      id: 'database',
      label: 'Database connectivity',
      status: 'pass',
      detail: `${dbAccounts.length} account row(s) readable`,
    });
  } catch (err) {
    checks.push({
      id: 'database',
      label: 'Database connectivity',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  let knownIds = [];
  try {
    knownIds = Array.from(await getKnownAccountIdsSet());
    checks.push({
      id: 'accounts',
      label: 'Configured account registry',
      status: knownIds.length > 0 ? 'pass' : 'warn',
      detail: knownIds.length > 0 ? `${knownIds.length} account(s) available` : 'No accounts configured yet',
    });
  } catch (err) {
    checks.push({
      id: 'accounts',
      label: 'Configured account registry',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  let sessionCount = 0;
  for (const accountId of knownIds) {
    const meta = await sessionMeta(accountId).catch(() => null);
    if (meta?.savedAt) {
      sessionCount += 1;
    }
  }

  checks.push({
    id: 'sessions',
    label: 'Imported LinkedIn sessions',
    status: sessionCount > 0 ? 'pass' : (knownIds.length > 0 ? 'warn' : 'pass'),
    detail: knownIds.length > 0
      ? `${sessionCount}/${knownIds.length} account(s) have saved cookies`
      : 'No accounts configured yet',
  });

  checks.push({
    id: 'scheduler',
    label: 'Automatic sync scheduler',
    status: process.env.DISABLE_MESSAGE_SYNC === '1' ? 'warn' : 'pass',
    detail: process.env.DISABLE_MESSAGE_SYNC === '1'
      ? 'DISABLE_MESSAGE_SYNC=1'
      : `Runs every ${Math.max(1, parseInt(process.env.SYNC_INTERVAL_MINUTES || '10', 10) || 10)} minute(s)`,
  });

  const healthSummary = await buildHealthSummary();

  return {
    status: checks.some((check) => check.status === 'fail')
      ? 'fail'
      : checks.some((check) => check.status === 'warn')
        ? 'warn'
        : 'pass',
    generatedAt: Date.now(),
    checks,
    healthSummary: {
      status: healthSummary.status,
      criticalAlerts: healthSummary.totals.criticalAlerts,
      warningAlerts: healthSummary.totals.warningAlerts,
      accountsNeedingAttention: healthSummary.totals.accountsNeedingAttention,
    },
  };
}

// â”€â”€ Health (no auth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function connectionKey(accountId, name, profileUrl) {
  const normalizedUrl = normalizeProfileUrlForCompare(profileUrl);
  const normalizedName = normalizeWhitespace(name).toLowerCase();
  return `${accountId}|${normalizedUrl || normalizedName}`;
}

const CONNECTION_LIVE_SCRAPE_SESSION_COOLDOWN_MS = Math.max(
  0,
  parseInt(
    process.env.CONNECTION_LIVE_SCRAPE_SESSION_COOLDOWN_MS || String(15 * 60_000),
    10
  ) || 15 * 60_000
);

function pushLatestConnection(latestByConnection, item) {
  if (!item?.accountId) return;
  const key = connectionKey(item.accountId, item.name, item.profileUrl);
  const previous = latestByConnection.get(key);
  const currentTs = Number(item.connectedAt) || 0;
  const previousTs = Number(previous?.connectedAt) || 0;
  if (!previous || currentTs >= previousTs) {
    latestByConnection.set(key, item);
  }
}

function mapActivityEntryToConnection(accountId, entry) {
  if (!entry || entry.type !== 'connectionSent') {
    return null;
  }
  const profileUrl = String(entry.targetProfileUrl || '');
  const name = normalizeParticipantName(entry.targetName, profileUrl);
  if (!name || name === 'Unknown') return null;

  return {
    accountId,
    name,
    profileUrl,
    connectedAt: Number(entry.timestamp) || Date.now(),
    source: entry.type,
  };
}

function finalizeUnifiedConnections(latestByConnection, limit = 300) {
  return Array.from(latestByConnection.values())
    .sort((a, b) => {
      const tsDiff = (Number(b.connectedAt) || 0) - (Number(a.connectedAt) || 0);
      if (tsDiff !== 0) return tsDiff;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, limit);
}

function mergeConnectionList(latestByConnection, items = []) {
  for (const item of items || []) {
    const profileUrl = String(item?.profileUrl || '');
    const name = normalizeParticipantName(item?.name, profileUrl);
    if (!name || name === 'Unknown') continue;

    pushLatestConnection(latestByConnection, {
      accountId: item.accountId,
      name,
      profileUrl,
      headline: item?.headline || '',
      connectedAt: Number(item?.connectedAt) || undefined,
      source: item?.source || 'linkedin',
    });
  }
}

async function seedUnifiedConnectionsFromActivity() {
  const ids = await listKnownAccountIds();
  const latestByConnection = new Map();

  for (const accountId of ids) {
    const activityEntries = await getRecentActivityEntries(accountId, 1000);
    for (const entry of activityEntries) {
      const mapped = mapActivityEntryToConnection(accountId, entry);
      if (mapped) {
        pushLatestConnection(latestByConnection, {
          ...mapped,
        });
      }
    }
  }

  return { ids, latestByConnection };
}

async function getLiveScrapeEligibleAccountIds(accountIds = []) {
  const healthState = getHealthStateSnapshot();
  const eligible = [];

  for (const accountId of accountIds) {
    const state = healthState.accounts[accountId] || {};
    if (state.sessionIssue) {
      console.warn(
        `[Connections] Skipping live scrape for ${accountId}; session issue is active (${state.sessionIssue.code || 'unknown'}).`
      );
      continue;
    }

    const meta = await sessionMeta(accountId).catch(() => null);
    const ageMs = Number(meta?.ageSeconds) > 0 ? Number(meta.ageSeconds) * 1000 : 0;
    if (
      CONNECTION_LIVE_SCRAPE_SESSION_COOLDOWN_MS > 0 &&
      ageMs > 0 &&
      ageMs < CONNECTION_LIVE_SCRAPE_SESSION_COOLDOWN_MS
    ) {
      console.warn(
        `[Connections] Skipping live scrape for ${accountId}; session was refreshed ${Math.round(ageMs / 1000)}s ago.`
      );
      continue;
    }

    eligible.push(accountId);
  }

  return eligible;
}

async function buildUnifiedConnections(limit = 300, { includeLive = true } = {}) {
  const { ids, latestByConnection } = await seedUnifiedConnectionsFromActivity();

  if (!includeLive) {
    return { connections: finalizeUnifiedConnections(latestByConnection, limit) };
  }

  const eligibleIds = await getLiveScrapeEligibleAccountIds(ids);
  if (eligibleIds.length === 0) {
    return { connections: finalizeUnifiedConnections(latestByConnection, limit) };
  }

  const proxyUrl = process.env.PROXY_URL || null;
  const liveResults = await Promise.allSettled(
    eligibleIds.map(async (accountId) => {
      try {
        const result = await runJob(
          'readConnections',
          { accountId, proxyUrl, limit: Math.min(limit, 200) },
          90_000
        );
        return { accountId, items: result?.items || [] };
      } catch (queueErr) {
        const msg = queueErr instanceof Error ? queueErr.message : String(queueErr);
        const isRedisConnectivityError =
          msg.includes('Connection is closed') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('ENOTFOUND') ||
          msg.includes('getaddrinfo');

        if (!isRedisConnectivityError) {
          throw queueErr;
        }

        const directResult = await readConnections({
          accountId,
          proxyUrl,
          limit: Math.min(limit, 200),
        });
        return { accountId, items: directResult?.items || [] };
      }
    })
  );

  for (const result of liveResults) {
    if (result.status !== 'fulfilled') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`[Connections] Live connections scrape failed: ${reason}`);
      continue;
    }

    mergeConnectionList(
      latestByConnection,
      (result.value.items || []).map((item) => ({
        ...item,
        accountId: result.value.accountId,
        source: 'linkedin',
      }))
    );
  }

  return { connections: finalizeUnifiedConnections(latestByConnection, limit) };
}

const UNIFIED_CONNECTIONS_CACHE_TTL_MS = 300_000;
let unifiedConnectionsCache = {
  expiresAt: 0,
  payload: { connections: [] },
};
let unifiedConnectionsInFlight = null;

async function getUnifiedConnectionsWithCache(limit = 300, { refresh = false } = {}) {
  if (refresh) {
    unifiedConnectionsCache.expiresAt = 0;
  }

  if (!refresh) {
    const latestByConnection = new Map();
    mergeConnectionList(latestByConnection, unifiedConnectionsCache.payload.connections || []);

    const activityPayload = await buildUnifiedConnections(limit, { includeLive: false });
    mergeConnectionList(latestByConnection, activityPayload.connections || []);

    return { connections: finalizeUnifiedConnections(latestByConnection, limit) };
  }

  unifiedConnectionsInFlight = (async () => {
    const payload = await buildUnifiedConnections(limit, { includeLive: true });
    unifiedConnectionsCache = {
      expiresAt: Date.now() + UNIFIED_CONNECTIONS_CACHE_TTL_MS,
      payload,
    };
    return payload;
  })();

  try {
    const payload = await unifiedConnectionsInFlight;
    return { connections: payload.connections.slice(0, limit) };
  } finally {
    unifiedConnectionsInFlight = null;
  }
}

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
  const participantAvatarUrl = String(item?.participants?.[0]?.avatarUrl || '');
  const rawId = String(item?.id || `unknown-${Date.now()}`);
  const createdAt = item?.lastMessage?.createdAt || item?.createdAt || new Date().toISOString();
  const sentAt = Number(new Date(createdAt).getTime()) || Date.now();

  return {
    conversationId: `${accountId}:${rawId}`,
    accountId,
    participant: {
      name: participantName,
      profileUrl: participantProfileUrl,
      avatarUrl: participantAvatarUrl || null,
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

function getConversationSentAt(conv) {
  return Number(conv?.lastMessage?.sentAt) || 0;
}

function getConversationText(conv) {
  return normalizeWhitespace(conv?.lastMessage?.text || '');
}

function getConversationProfileUrl(conv) {
  return normalizeProfileUrlForCompare(conv?.participant?.profileUrl || '');
}

function getConversationAvatarUrl(conv) {
  return String(conv?.participant?.avatarUrl || '').trim();
}

function getConversationNameToken(conv) {
  return normalizeWhitespace(conv?.participant?.name || '').toLowerCase();
}

function conversationQualityScore(conv) {
  const hasProfile = Boolean(getConversationProfileUrl(conv));
  const hasText = Boolean(getConversationText(conv));
  const hasMessages = Array.isArray(conv?.messages) && conv.messages.length > 0;
  const conversationId = String(conv?.conversationId || '');
  const isFallbackId = conversationId.startsWith('fallback-');
  const isActivityId = conversationId.startsWith('activity-');

  let score = 0;
  if (hasProfile) score += 40;
  if (hasText) score += 20;
  if (hasMessages) score += 10;
  if (isActivityId) score += 5;
  if (isFallbackId) score -= 15;
  return score;
}

function isLowSignalFallbackConversation(conv) {
  const conversationId = String(conv?.conversationId || '');
  const hasProfile = Boolean(getConversationProfileUrl(conv));
  const hasText = Boolean(getConversationText(conv));
  return conversationId.startsWith('fallback-') && !hasProfile && !hasText;
}

function shouldReplaceConversation(previous, current) {
  const previousScore = conversationQualityScore(previous);
  const currentScore = conversationQualityScore(current);
  if (currentScore !== previousScore) {
    return currentScore > previousScore;
  }

  const previousSentAt = getConversationSentAt(previous);
  const currentSentAt = getConversationSentAt(current);
  if (currentSentAt !== previousSentAt) {
    return currentSentAt > previousSentAt;
  }

  const previousUnread = Number(previous?.unreadCount) || 0;
  const currentUnread = Number(current?.unreadCount) || 0;
  return currentUnread > previousUnread;
}

function dedupeAndSortConversations(conversations) {
  const profileAliasByName = new Map();
  const avatarAliasByName = new Map();

  for (const conv of conversations) {
    if (!conv?.accountId) continue;
    const profileUrl = getConversationProfileUrl(conv);
    const avatarUrl = getConversationAvatarUrl(conv);
    const nameToken = getConversationNameToken(conv);
    if (!profileUrl || !nameToken) continue;

    const aliasKey = `${conv.accountId}|${nameToken}`;
    const previous = profileAliasByName.get(aliasKey);
    if (!previous || getConversationSentAt(conv) >= previous.sentAt) {
      profileAliasByName.set(aliasKey, {
        profileUrl,
        sentAt: getConversationSentAt(conv),
      });
    }

    if (avatarUrl) {
      const previousAvatar = avatarAliasByName.get(aliasKey);
      if (!previousAvatar || getConversationSentAt(conv) >= previousAvatar.sentAt) {
        avatarAliasByName.set(aliasKey, {
          avatarUrl,
          sentAt: getConversationSentAt(conv),
        });
      }
    }
  }

  const latestByConversation = new Map();

  for (const conv of conversations) {
    if (!conv?.accountId) continue;

    const nameToken = getConversationNameToken(conv);
    const directProfileUrl = getConversationProfileUrl(conv);
    const directAvatarUrl = getConversationAvatarUrl(conv);
    const aliasProfileUrl = nameToken
      ? profileAliasByName.get(`${conv.accountId}|${nameToken}`)?.profileUrl || ''
      : '';
    const aliasAvatarUrl = nameToken
      ? avatarAliasByName.get(`${conv.accountId}|${nameToken}`)?.avatarUrl || ''
      : '';
    const resolvedProfileUrl = directProfileUrl || aliasProfileUrl;
    const resolvedAvatarUrl = directAvatarUrl || aliasAvatarUrl;
    const key = resolvedProfileUrl
      ? `${conv.accountId}|profile|${resolvedProfileUrl}`
      : `${conv.accountId}|name|${nameToken || String(conv?.conversationId || '').toLowerCase()}`;

    const enrichedConversation = {
      ...conv,
      participant: {
        ...conv.participant,
        profileUrl: resolvedProfileUrl || conv?.participant?.profileUrl || '',
        avatarUrl: resolvedAvatarUrl || conv?.participant?.avatarUrl || null,
      },
    };

    const previous = latestByConversation.get(key);
    if (!previous || shouldReplaceConversation(previous, enrichedConversation)) {
      latestByConversation.set(key, enrichedConversation);
    }
  }

  const sorted = Array.from(latestByConversation.values()).sort(
    (a, b) => (Number(b?.lastMessage?.sentAt) || 0) - (Number(a?.lastMessage?.sentAt) || 0)
  );

  const hasHighSignalRows = sorted.some(
    (conv) => Boolean(getConversationProfileUrl(conv)) || Boolean(getConversationText(conv))
  );

  if (!hasHighSignalRows) {
    return sorted;
  }

  const cleaned = sorted.filter((conv) => !isLowSignalFallbackConversation(conv));
  return cleaned.length > 0 ? cleaned : sorted;
}

async function persistOptimisticSendNewResult({ accountId, profileUrl, text, result }) {
  let messageRepo;
  try {
    messageRepo = require('./db/repositories/MessageRepository');
  } catch {
    return;
  }

  const participantProfileUrl = String(profileUrl || '');
  const participantName = normalizeParticipantName('', participantProfileUrl);
  const rawChatId = String(result?.chatId || '').trim();
  const fallbackKey = `${accountId}|${participantName}|${participantProfileUrl}`;
  const conversationId =
    rawChatId && rawChatId !== 'new'
      ? normalizeThreadId(accountId, rawChatId)
      : `activity-${Buffer.from(fallbackKey).toString('base64url')}`;

  const parsedCreatedAt = new Date(result?.createdAt || Date.now());
  const createdAt = Number.isNaN(parsedCreatedAt.getTime()) ? new Date() : parsedCreatedAt;
  const messageId = String(result?.id || `optimistic-${Date.now()}`);

  try {
    await withTimeout(
      messageRepo.upsertConversation({
        id: conversationId,
        accountId,
        participantName,
        participantProfileUrl,
        participantAvatarUrl: null,
        lastMessageAt: createdAt,
        lastMessageText: text,
        lastMessageSentByMe: true,
      }),
      4000
    );

    await withTimeout(
      messageRepo.upsertMessage({
        conversationId,
        accountId,
        senderId: '__self__',
        senderName: accountId,
        text,
        sentAt: createdAt.toISOString(),
        isSentByMe: true,
        linkedinMessageId: messageId,
      }),
      4000
    );
  } catch (err) {
    if (!isDatabaseUnavailable(err)) {
      console.warn('[send-new] Optimistic DB persistence failed:', err?.message || String(err));
    }
  }
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
      clearSessionIssue(accountId);
      for (const item of inbox?.items || []) {
        conversations.push(normalizeConversationFromInboxItem(accountId, item));
      }
    } catch (err) {
      const code = err?.code;
      if (code === 'NO_SESSION' || code === 'SESSION_EXPIRED') {
        markSessionIssue(accountId, {
          code,
          message: err?.message || 'LinkedIn session expired. Refresh cookies.',
        });
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
const {
  clearSessionIssue,
  getHealthStateSnapshot,
  markBulkSyncStarted,
  markSessionIssue,
  markSyncStarted,
} = require('./healthState');

async function getKnownAccountIdsSet() {
  const ids = new Set(
    (await listKnownAccountIds())
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );

  try {
    const dbAccounts = await withTimeout(accountRepo.getAllAccounts(), 4000);
    for (const account of dbAccounts || []) {
      const id = String(account?.id || '').trim();
      if (id) ids.add(id);
    }
  } catch (err) {
    if (!isDatabaseUnavailable(err)) {
      throw err;
    }
    if (ids.size === 0) {
      const lookupErr = new Error('Account registry is unavailable. Retry after database connectivity is restored.');
      lookupErr.status = 503;
      lookupErr.code = 'ACCOUNT_LOOKUP_UNAVAILABLE';
      throw lookupErr;
    }
  }

  return ids;
}

async function assertKnownAccountId(accountId) {
  const normalizedAccountId = validateId(accountId, { field: 'accountId' });
  const knownIds = await getKnownAccountIdsSet();
  if (knownIds.has(normalizedAccountId)) {
    return normalizedAccountId;
  }

  const err = new Error(`Unknown accountId: ${normalizedAccountId}`);
  err.status = 404;
  err.code = 'UNKNOWN_ACCOUNT';
  throw err;
}

async function assertConversationBelongsToAccount(accountId, conversationId) {
  const rawChatId = validateId(conversationId, { field: 'chatId' });
  const normalizedChatId = normalizeThreadId(accountId, rawChatId);

  if (normalizedChatId.startsWith('activity-') || normalizedChatId === 'new') {
    return normalizedChatId;
  }

  const messageRepo = require('./db/repositories/MessageRepository');
  let conversation = null;

  try {
    conversation = await withTimeout(messageRepo.getConversationById(rawChatId), 4000);
    if (!conversation && normalizedChatId !== rawChatId) {
      conversation = await withTimeout(messageRepo.getConversationById(normalizedChatId), 4000);
    }
  } catch (err) {
    if (!isDatabaseUnavailable(err)) {
      throw err;
    }
    const lookupErr = new Error('Conversation lookup unavailable. Retry after database connectivity is restored.');
    lookupErr.status = 503;
    lookupErr.code = 'CONVERSATION_LOOKUP_UNAVAILABLE';
    throw lookupErr;
  }

  if (!conversation) {
    const err = new Error(`Unknown chatId for account ${accountId}`);
    err.status = 404;
    err.code = 'UNKNOWN_CHAT';
    throw err;
  }

  if (String(conversation.accountId || '') !== String(accountId)) {
    const err = new Error(`chatId does not belong to account ${accountId}`);
    err.status = 403;
    err.code = 'CHAT_ACCOUNT_MISMATCH';
    throw err;
  }

  return normalizedChatId;
}

// Mount export routes
app.use('/export', exportRoutes);

app.get('/health/summary', async (_req, res) => {
  try {
    const summary = await buildHealthSummary();
    res.json(summary);
  } catch (err) {
    console.error('[API] Health summary failed:', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

app.get('/health/startup-validation', async (_req, res) => {
  try {
    const report = await buildStartupValidationReport();
    res.json(report);
  } catch (err) {
    console.error('[API] Startup validation failed:', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// POST /sync/messages - Manual message sync trigger
app.post('/sync/messages', async (req, res) => {
  try {
    const accountId = req.body?.accountId
      ? await assertKnownAccountId(req.body.accountId)
      : '';
    const proxyUrl = process.env.PROXY_URL || null;

    console.log('[API] Manual sync triggered', accountId ? `for account ${accountId}` : 'for all accounts');

    // Trigger sync in background (don't wait for completion)
    if (accountId) {
      markSyncStarted(accountId, 'manual');
      syncAccount(accountId, proxyUrl, { source: 'manual' })
        .then(stats => console.log('[API] Manual sync completed:', stats))
        .catch(err => console.error('[API] Manual sync failed:', err));
      
      res.json({ 
        success: true, 
        message: `Sync started for account ${accountId}`,
        accountId,
      });
    } else {
      const configuredIds = (process.env.ACCOUNT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
      markBulkSyncStarted(configuredIds, 'manual');
      syncAllAccounts(proxyUrl, { source: 'manual' })
        .then(stats => console.log('[API] Manual sync completed:', stats))
        .catch(err => console.error('[API] Manual sync failed:', err));
      
      res.json({ 
        success: true, 
        message: 'Sync started for all accounts',
      });
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
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
    if (!hasRequiredLinkedInSessionCookies(cookies)) {
      return res.status(400).json({
        error: `Required LinkedIn cookies (li_at/JSESSIONID) are missing for account ${accountId}. Re-import cookies.`,
        code: 'COOKIES_MISSING',
      });
    }
    await saveCookies(accountId, cookies, { requireAuthCookies: true, source: 'api-import' });
    clearSessionIssue(accountId);
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
    const accountId = await assertKnownAccountId(req.params.accountId);
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
  const selfRetryingJobs = new Set(['verifySession', 'readConnections', 'readMessages', 'readThread', 'searchPeople']);
  const dedupeWindowJobs = new Set(['messageSync']);

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
  
  // Only dedupe periodic background jobs.
  // Verify/send/read jobs must always run fresh so cookie or UI state changes are honored immediately.
  const jobId = dedupeWindowJobs.has(name)
    ? `${name}:${accountId}:${Math.floor(Date.now() / 30_000)}`
    : undefined;

  let job;
  try {
    const retryOptions = (nonIdempotentJobs.has(name) || selfRetryingJobs.has(name))
      ? { attempts: 1 }
      : {
          // Retry once with exponential backoff (5 s, then 10 s).
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
        };

    job = await queue.add(name, data, {
      ...(jobId ? { jobId } : {}),
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
      if (
        reason.includes('CHECKPOINT_INCOMPLETE') ||
        lowerReason.includes('checkpoint/challenge is still pending')
      ) {
        failErr.code = 'CHECKPOINT_INCOMPLETE';
        failErr.status = 401;
      } else if (reason.includes('LOGIN_NOT_FINISHED') || lowerReason.includes('login is not fully completed')) {
        failErr.code = 'LOGIN_NOT_FINISHED';
        failErr.status = 401;
      } else if (reason.includes('COOKIES_MISSING') || lowerReason.includes('li_at/jsessionid')) {
        failErr.code = 'COOKIES_MISSING';
        failErr.status = 401;
      } else if (reason.includes('AUTHENTICATED_STATE_NOT_REACHED') || lowerReason.includes('authenticated linkedin member state was not reached')) {
        failErr.code = 'AUTHENTICATED_STATE_NOT_REACHED';
        failErr.status = 401;
      } else if (reason.includes('Session expired for account')) {
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
    case 'readConnections':
      return readConnections(data);
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
      return syncAllAccounts(data.proxyUrl, { source: data.source });
    default:
      throw new Error(`Unknown job type: ${name}`);
  }
}

// â”€â”€ LinkedIn action endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.post('/accounts/:accountId/verify', async (req, res) => {
  try {
    const accountId = await assertKnownAccountId(req.params.accountId);
    const proxyUrl = process.env.PROXY_URL || null;
    res.setTimeout(230_000, () => {
      if (!res.headersSent) res.status(504).json({ error: 'Request timed out' });
    });

    // Verification is operator-triggered and already does its own retry/cleanup loop.
    // Running it directly avoids queue backoff stacking on top of browser retries.
    const result = await verifySession({ accountId, proxyUrl });

    clearSessionIssue(accountId);
    res.json(result);
  } catch (err) {
    if (['NO_SESSION', 'SESSION_EXPIRED', 'AUTHENTICATED_STATE_NOT_REACHED', 'COOKIES_MISSING'].includes(err?.code)) {
      markSessionIssue(req.params.accountId, {
        code: err.code,
        message: toPublicOperationError(err),
      });
    }
    const status = err.status || (err.message ? 400 : 500);
    res.status(status).json({
      error: toPublicOperationError(err),
      code: err.code,
    });
  }
});

app.get('/messages/inbox', async (req, res) => {
  try {
    const accountId = await assertKnownAccountId(req.query.accountId);
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
    const accountId = await assertKnownAccountId(req.query.accountId);
    const chatId    = validateId(req.query.chatId, { field: 'chatId' });
    const normalizedChatId = await assertConversationBelongsToAccount(accountId, chatId);
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

    if (liveItems.length === 0) {
      try {
        let conversation = await withTimeout(
          messageRepo.getConversationById(chatId),
          4000
        );

        if (!conversation && normalizedChatId !== chatId) {
          conversation = await withTimeout(
            messageRepo.getConversationById(normalizedChatId),
            4000
          );
        }

        const previewText = normalizeWhitespace(conversation?.lastMessageText || '');
        if (previewText) {
          const previewCreatedAt = new Date(conversation?.lastMessageAt || Date.now()).toISOString();
          const previewSentByMe = Boolean(conversation?.lastMessageSentByMe);
          return res.json({
            items: [{
              id: `preview-${normalizedChatId}`,
              chatId: normalizedChatId,
              senderId: previewSentByMe ? '__self__' : 'other',
              text: previewText,
              createdAt: previewCreatedAt,
              sentAt: previewCreatedAt,
              isSentByMe: previewSentByMe,
              senderName: previewSentByMe
                ? accountId
                : normalizeParticipantName(
                    conversation?.participantName,
                    conversation?.participantProfileUrl || ''
                  ),
            }],
            cursor: null,
            hasMore: false,
          });
        }
      } catch (previewErr) {
        if (!isDatabaseUnavailable(previewErr)) {
          console.warn('[Thread] Preview fallback failed:', previewErr.message || String(previewErr));
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
    const accountId = await assertKnownAccountId(req.body?.accountId);
    const normalizedChatId = await assertConversationBelongsToAccount(accountId, req.body?.chatId);
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
    const accountId  = await assertKnownAccountId(req.body?.accountId);
    const profileUrl = validateProfileUrl(req.body?.profileUrl);
    const text       = sanitizeText(req.body?.text, { maxLength: 3000 });
    if (!text) return res.status(400).json({ error: 'text is required' });
    res.setTimeout(230_000, () => {
      if (!res.headersSent) res.status(504).json({ error: 'Request timed out' });
    });

    let result;
    try {
      result = await runJob('sendMessageNew', {
        accountId, profileUrl, text, proxyUrl: process.env.PROXY_URL || null,
      }, 220_000);
    } catch (sendNewErr) {
      const sendNewReason = String(sendNewErr?.message || sendNewErr || '').toLowerCase();
      const skipThreadFallback =
        sendNewErr?.code === 'SEND_NOT_CONFIRMED' ||
        sendNewErr?.status === 504 ||
        sendNewReason.includes('timed out after') ||
        sendNewReason.includes('err_too_many_redirects') ||
        sendNewReason.includes('session expired for account') ||
        sendNewReason.includes('authenticated linkedin member state was not reached') ||
        sendNewReason.includes('checkpoint/challenge is still pending') ||
        sendNewReason.includes('login is not fully completed') ||
        sendNewReason.includes('cookies missing');

      if (skipThreadFallback) {
        throw sendNewErr;
      }

      // Always try thread fallback before failing send-new.
      // This helps when profile composer flow is flaky but an existing thread works.
      const reason = String(sendNewErr?.message || sendNewErr || '');
      console.warn(`[API] send-new failed for ${accountId}; trying thread fallback: ${reason}`);

      // Reset browser context before inbox fallback to avoid stale/half-closed sessions.
      await cleanupContext(accountId).catch(() => {});

      let inboxResult;
      try {
        inboxResult = await runJob('readMessages', {
          accountId,
          limit: 100,
          proxyUrl: process.env.PROXY_URL || null,
        }, 90_000);
      } catch (fallbackErr) {
        const fallbackReason = String(fallbackErr?.message || fallbackErr || '');
        console.warn(`[API] thread fallback inbox read failed for ${accountId}: ${fallbackReason}`);
        throw sendNewErr;
      }

      const normalizedTarget = normalizeProfileUrlForCompare(profileUrl);
      const matchedConversation = (inboxResult?.items || []).find((item) => {
        const participantUrl = item?.participants?.[0]?.profileUrl || '';
        return (
          participantUrl &&
          normalizeProfileUrlForCompare(participantUrl) === normalizedTarget
        );
      });

      if (!matchedConversation?.id) throw sendNewErr;

      result = await runJob('sendMessage', {
        accountId,
        chatId: matchedConversation.id,
        text,
        proxyUrl: process.env.PROXY_URL || null,
      });
    }

    await persistOptimisticSendNewResult({
      accountId,
      profileUrl,
      text,
      result,
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
    const accountId  = await assertKnownAccountId(req.body?.accountId);
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
app.get('/connections/unified', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 300, 1000);
    const refresh = String(req.query.refresh || '') === '1';
    const payload = await getUnifiedConnectionsWithCache(limit, { refresh });
    res.json(payload);
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({
        error: toPublicOperationError(err),
        code: err.code,
      });
    }

    console.error('[API] Error fetching unified connections:', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

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
          avatarUrl: conv.participantAvatarUrl || null,
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

    // Merge DB-backed conversations with recent activity so newly sent messages
    // show in the UI even before full thread sync catches up.
    const activityPayload = await buildUnifiedInboxFromActivity(limit);
    const mergedConversations = dedupeAndSortConversations([
      ...payload.conversations,
      ...(activityPayload?.conversations || []),
    ]).slice(0, limit);

    if (mergedConversations.length === 0) {
      const livePayload = await buildUnifiedInboxWithFallback(limit);
      return res.json(livePayload);
    }

    res.json({ conversations: mergedConversations });
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
    const recentActivityEntries = [];

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

        const activityEntries = await getRecentActivityEntries(id, 50);
        for (const entry of activityEntries) {
          if (!['messageSent', 'connectionSent', 'profileViewed'].includes(entry?.type)) {
            continue;
          }

          const profileUrl = String(entry.targetProfileUrl || '');
          recentActivityEntries.push({
            ...entry,
            targetName: normalizeParticipantName(entry.targetName, profileUrl),
            message:
              typeof entry.message === 'string' && entry.message.trim()
                ? entry.message
                : (typeof entry.textPreview === 'string' ? entry.textPreview : undefined),
          });
        }

        return { id, totalActivity: parsedMsgs + parsedConns };
      })
    );

    const recentActivity = dedupeRecentActivity(recentActivityEntries)
      .sort((a, b) => (Number(b?.timestamp) || 0) - (Number(a?.timestamp) || 0))
      .slice(0, 10);

    res.json({
      accounts: Object.fromEntries(accountStats.map(a => [a.id, a])),
      totalMessages,
      totalConnections,
      totalActivity: totalMessages + totalConnections,
      recentActivity,
    });
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

app.get('/stats/:accountId/summary', async (req, res) => {
  try {
    const accountId = await assertKnownAccountId(req.params.accountId);
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
    const accountId = await assertKnownAccountId(req.params.accountId);
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
        message:
          typeof entry.message === 'string' && entry.message.trim()
            ? entry.message
            : (typeof entry.textPreview === 'string' ? entry.textPreview : undefined),
      };
    });

    const optimizedEntries = dedupeRecentActivity(entries).slice(0, limit);

    res.json({ entries: optimizedEntries, total });
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

app.get('/people/search', async (req, res) => {
  try {
    const accountId = await assertKnownAccountId(req.query.accountId);
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
