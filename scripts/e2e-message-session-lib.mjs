import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import pg from 'pg';

const { Client } = pg;
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_FRONTEND_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_WORKER_BASE_URL = 'http://127.0.0.1:3001';
const DEFAULT_MESSAGE_PREFIX = 'E2E local test';

let envLoaded = false;

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const equalsIndex = trimmed.indexOf('=');
  if (equalsIndex <= 0) return null;

  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

export function loadLocalEnv() {
  if (envLoaded) return;
  envLoaded = true;

  const candidates = [
    path.join(REPO_ROOT, '.env.local'),
    path.join(REPO_ROOT, '.env'),
    path.join(REPO_ROOT, 'worker', '.env'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (
        parsed.value &&
        (
          !(parsed.key in process.env) ||
          !String(process.env[parsed.key] || '').trim()
        )
      ) {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
}

function trimOrEmpty(value) {
  return String(value || '').trim();
}

function asBoolean(value, fallback = false) {
  const normalized = trimOrEmpty(value).toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function asInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeUrl(input, fallback) {
  const candidate = trimOrEmpty(input) || fallback;
  return candidate.replace(/\/$/, '');
}

export function getConfig() {
  loadLocalEnv();

  return {
    frontendBaseUrl: safeUrl(process.env.E2E_FRONTEND_BASE_URL || process.env.FRONTEND_BASE_URL, DEFAULT_FRONTEND_BASE_URL),
    workerBaseUrl: safeUrl(process.env.E2E_WORKER_BASE_URL || process.env.BASE_URL, DEFAULT_WORKER_BASE_URL),
    accountId: trimOrEmpty(process.env.E2E_TEST_ACCOUNT_ID || process.env.TEST_ACCOUNT_ID || 'saikanchi130'),
    recipientName: trimOrEmpty(process.env.E2E_TEST_RECIPIENT_NAME || process.env.TEST_TARGET_NAME),
    recipientProfileUrl: trimOrEmpty(process.env.E2E_TEST_RECIPIENT_PROFILE_URL || process.env.TEST_TARGET_PROFILE_URL),
    messagePrefix: trimOrEmpty(process.env.E2E_TEST_MESSAGE_PREFIX || process.env.TEST_MESSAGE_PREFIX || DEFAULT_MESSAGE_PREFIX),
    enableRealLinkedinTests: asBoolean(process.env.E2E_ENABLE_REAL_LINKEDIN_TESTS, false),
    timeoutMs: asInteger(process.env.TEST_TIMEOUT_MS || process.env.E2E_TEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    apiSecret: trimOrEmpty(process.env.API_SECRET),
    dashboardEmail: trimOrEmpty(process.env.E2E_TEST_USER_EMAIL),
    dashboardPassword: trimOrEmpty(process.env.E2E_TEST_USER_PASSWORD),
    inboundSenderAccountId: trimOrEmpty(process.env.E2E_INBOUND_SENDER_ACCOUNT_ID),
    inboundReceiverAccountId: trimOrEmpty(process.env.E2E_INBOUND_RECEIVER_ACCOUNT_ID || process.env.E2E_TEST_ACCOUNT_ID || 'saikanchi130'),
    inboundReceiverProfileUrl: trimOrEmpty(process.env.E2E_INBOUND_RECEIVER_PROFILE_URL),
    inboundMessagePrefix: trimOrEmpty(process.env.E2E_INBOUND_MESSAGE_PREFIX || 'E2E inbound local test'),
    databaseUrl: trimOrEmpty(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL),
  };
}

export function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

export function buildUniqueSafeMessage(prefix) {
  const cleanedPrefix = trimOrEmpty(prefix) || DEFAULT_MESSAGE_PREFIX;
  if (/[<>]/.test(cleanedPrefix)) {
    throw new Error('E2E message prefix must not contain angle brackets. Use a harmless plain-text prefix.');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const randomId = crypto.randomBytes(3).toString('hex');
  const message = `${cleanedPrefix} ${timestamp} ${randomId}`.trim();

  if (message.length > 240) {
    throw new Error('Generated E2E message is too long. Shorten E2E_TEST_MESSAGE_PREFIX.');
  }

  return {
    text: message,
    fingerprint: hashValue(message),
  };
}

export function logStep(message, fields) {
  const payload = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
  console.log(`[E2E] ${message}${payload}`);
}

export function createSummarySkeleton() {
  return {
    frontend: 'PENDING',
    worker: 'PENDING',
    db: 'PENDING',
    redis: 'PENDING',
    session: 'PENDING',
    cookies: 'PENDING',
    verify: 'PENDING',
    rateLimit: 'PENDING',
    recipient: 'PENDING',
  };
}

function ensure(condition, message, code = 'ASSERTION_FAILED') {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

export async function requestJson(url, init = {}, options = {}) {
  const { timeoutMs = 30_000, allowText = false } = options;
  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`Request to ${url} failed: ${message}`);
    wrapped.code = error?.code || 'REQUEST_FAILED';
    throw wrapped;
  }

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (!allowText) {
        const err = new Error(`Expected JSON response from ${url}, received non-JSON payload.`);
        err.responseText = text;
        throw err;
      }
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text,
    json,
  };
}

export async function pingFrontend(config) {
  const result = await requestJson(`${config.frontendBaseUrl}/api/auth/verify`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  }, { timeoutMs: 20_000 });

  ensure([200, 401].includes(result.status), `Frontend is reachable but returned unexpected status ${result.status} from /api/auth/verify.`, 'FRONTEND_UNEXPECTED_STATUS');
  return result;
}

export async function getWorkerHealth(config) {
  return requestJson(`${config.workerBaseUrl}/health`, {
    method: 'GET',
    headers: buildWorkerHeaders(config, { 'x-request-id': `e2e-health-${Date.now()}` }),
  }, { timeoutMs: 20_000 });
}

export function buildWorkerHeaders(config, extraHeaders = {}) {
  return {
    Accept: 'application/json',
    ...(config.apiSecret ? { 'x-api-key': config.apiSecret } : {}),
    ...extraHeaders,
  };
}

export function buildAppHeaders(config, cookieHeader, extraHeaders = {}) {
  return {
    Accept: 'application/json',
    Origin: config.frontendBaseUrl,
    Referer: `${config.frontendBaseUrl}/`,
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...extraHeaders,
  };
}

export async function queryDatabase(config, queryText, values = []) {
  ensure(config.databaseUrl, 'DATABASE_URL (or POSTGRES_URL) is required for DB persistence checks.', 'DATABASE_URL_MISSING');
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    return await client.query(queryText, values);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function checkDatabaseReachable(config) {
  const result = await queryDatabase(config, 'SELECT 1 AS ok');
  ensure(result.rows?.[0]?.ok === 1, 'Database ping failed.', 'DATABASE_UNREACHABLE');
  return result.rows[0];
}

export async function getSessionCookieFlags(accountId) {
  loadLocalEnv();
  const { loadCookies, getLinkedInCookieFlags } = require('../worker/src/session.js');
  const cookies = await loadCookies(accountId);
  if (!cookies || cookies.length === 0) {
    return {
      exists: false,
      total: 0,
      hasLiAt: false,
      hasJsession: false,
    };
  }

  return {
    exists: true,
    ...getLinkedInCookieFlags(cookies),
  };
}

export async function getWorkerSessionStatus(config, accountId) {
  return requestJson(`${config.workerBaseUrl}/accounts/${encodeURIComponent(accountId)}/session/status`, {
    method: 'GET',
    headers: buildWorkerHeaders(config, { 'x-request-id': `e2e-session-${Date.now()}` }),
  }, { timeoutMs: 20_000 });
}

export async function verifyWorkerSession(config, accountId) {
  return requestJson(`${config.workerBaseUrl}/accounts/${encodeURIComponent(accountId)}/verify`, {
    method: 'POST',
    headers: buildWorkerHeaders(config, {
      'content-type': 'application/json',
      'x-request-id': `e2e-verify-${Date.now()}`,
    }),
    body: JSON.stringify({}),
  }, { timeoutMs: Math.max(90_000, config.timeoutMs) });
}

export async function getWorkerLimits(config, accountId) {
  return requestJson(`${config.workerBaseUrl}/accounts/${encodeURIComponent(accountId)}/limits`, {
    method: 'GET',
    headers: buildWorkerHeaders(config, { 'x-request-id': `e2e-limits-${Date.now()}` }),
  }, { timeoutMs: 20_000 });
}

export function evaluateMessageRateLimit(limitsPayload) {
  const messageLimits = limitsPayload?.messagesSent;
  ensure(messageLimits, 'Worker did not return messagesSent rate-limit details.', 'RATE_LIMIT_DATA_MISSING');

  const remaining = Number(messageLimits.remaining ?? 0);
  const nextAllowedAt = Number(messageLimits.nextAllowedAt ?? 0);
  const now = Date.now();

  ensure(remaining >= 1, 'Rate limit remaining is 0. Wait for the next window before running the real send test.', 'RATE_LIMIT_EXHAUSTED');
  ensure(nextAllowedAt <= now, `Cooldown still active for another ${Math.ceil((nextAllowedAt - now) / 1000)}s.`, 'SEND_COOLDOWN_ACTIVE');

  return {
    remaining,
    current: Number(messageLimits.current ?? 0),
    limit: Number(messageLimits.limit ?? 0),
    nextAllowedAt,
  };
}

export async function runPreflightChecks(config) {
  const summary = createSummarySkeleton();
  const details = {};
  const preparedMessage = buildUniqueSafeMessage(config.messagePrefix);
  let activeStep = 'frontend';

  ensure(config.accountId, 'E2E_TEST_ACCOUNT_ID (or TEST_ACCOUNT_ID) is required.', 'ACCOUNT_ID_MISSING');
  ensure(config.apiSecret, 'API_SECRET is required for worker preflight checks.', 'API_SECRET_MISSING');

  try {
    activeStep = 'frontend';
    const frontend = await pingFrontend(config);
    summary.frontend = 'PASS';
    details.frontendStatus = frontend.status;

    activeStep = 'worker';
    const health = await getWorkerHealth(config);
    ensure(health.ok, `Worker /health failed with status ${health.status}.`, 'WORKER_HEALTH_FAILED');
    ensure(health.json?.criticalDependencies?.database === true, 'Worker health reports database as unhealthy.', 'DB_UNHEALTHY');
    ensure(health.json?.criticalDependencies?.redis === true, 'Worker health reports redis as unhealthy.', 'REDIS_UNHEALTHY');
    summary.worker = 'PASS';
    summary.db = 'PASS';
    summary.redis = 'PASS';
    details.workerHealth = health.json?.status || 'unknown';

    activeStep = 'db';
    await checkDatabaseReachable(config);
    details.databasePing = 'ok';

    activeStep = 'session';
    const sessionStatus = await getWorkerSessionStatus(config, config.accountId);
    ensure(sessionStatus.ok && sessionStatus.json?.exists === true, `No saved LinkedIn session exists for account ${config.accountId}.`, 'SESSION_MISSING');
    summary.session = 'PASS';
    details.sessionAgeSeconds = Number(sessionStatus.json?.ageSeconds ?? 0);

    activeStep = 'cookies';
    const cookieFlags = await getSessionCookieFlags(config.accountId);
    ensure(cookieFlags.exists, `Session cookies could not be loaded for account ${config.accountId}.`, 'SESSION_COOKIES_UNAVAILABLE');
    ensure(cookieFlags.hasLiAt && cookieFlags.hasJsession, 'Required LinkedIn cookies are missing (li_at/JSESSIONID). Re-import cookies before running the real E2E test.', 'REQUIRED_COOKIES_MISSING');
    summary.cookies = 'PASS';
    details.cookieFlags = {
      linkedinCookieCount: cookieFlags.total,
      hasLiAt: cookieFlags.hasLiAt,
      hasJsession: cookieFlags.hasJsession,
    };

    activeStep = 'verify';
    const verify = await verifyWorkerSession(config, config.accountId);
    ensure(verify.ok && verify.json?.ok === true, verify.json?.error || `Session verify failed with status ${verify.status}.`, verify.json?.code || 'VERIFY_FAILED');
    summary.verify = 'PASS';
    details.verify = {
      via: verify.json?.via || null,
      url: verify.json?.url || null,
    };

    activeStep = 'rateLimit';
    const limits = await getWorkerLimits(config, config.accountId);
    ensure(limits.ok, `Rate-limit lookup failed with status ${limits.status}.`, 'RATE_LIMIT_LOOKUP_FAILED');
    details.rateLimit = evaluateMessageRateLimit(limits.json);
    summary.rateLimit = 'PASS';

    activeStep = 'recipient';
    ensure(config.recipientName || config.recipientProfileUrl, 'Configure E2E_TEST_RECIPIENT_NAME or E2E_TEST_RECIPIENT_PROFILE_URL before running the real LinkedIn send test.', 'RECIPIENT_NOT_CONFIGURED');
    summary.recipient = 'PASS';
    details.messageFingerprint = preparedMessage.fingerprint;

    return {
      ok: true,
      summary,
      details,
      preparedMessage,
    };
  } catch (error) {
    const code = error?.code || 'PREFLIGHT_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      summary: {
        ...summary,
        [activeStep]: 'FAIL',
      },
      details,
      error: { code, message },
      preparedMessage,
    };
  }
}

export function extractCookieHeader(response) {
  const setCookieValues = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (() => {
        const raw = response.headers.get('set-cookie');
        return raw ? [raw] : [];
      })();

  const cookiePairs = setCookieValues
    .map((cookieLine) => cookieLine.split(';')[0]?.trim())
    .filter(Boolean);

  ensure(cookiePairs.length > 0, 'Login did not return an app_session cookie.', 'SESSION_COOKIE_MISSING');
  return cookiePairs.join('; ');
}

export async function loginDashboard(config) {
  ensure(config.dashboardEmail, 'E2E_TEST_USER_EMAIL is required for app-level send/sync checks.', 'DASHBOARD_EMAIL_MISSING');
  ensure(config.dashboardPassword, 'E2E_TEST_USER_PASSWORD is required for app-level send/sync checks.', 'DASHBOARD_PASSWORD_MISSING');

  const response = await fetch(`${config.frontendBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      ...buildAppHeaders(config, '', {
        'content-type': 'application/json',
      }),
    },
    body: JSON.stringify({
      email: config.dashboardEmail,
      password: config.dashboardPassword,
      rememberMe: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  ensure(response.ok, json?.error || `Dashboard login failed with status ${response.status}.`, 'DASHBOARD_LOGIN_FAILED');

  const cookieHeader = extractCookieHeader(response);
  const verifyResponse = await requestJson(`${config.frontendBaseUrl}/api/auth/verify`, {
    method: 'GET',
    headers: buildAppHeaders(config, cookieHeader),
  }, { timeoutMs: 20_000 });

  ensure(verifyResponse.ok && verifyResponse.json?.authenticated === true, 'Dashboard session verification failed after login.', 'DASHBOARD_SESSION_VERIFY_FAILED');

  return {
    cookieHeader,
    user: verifyResponse.json?.user || json?.user || null,
  };
}

export async function appApiRequest(config, cookieHeader, pathName, options = {}) {
  const { method = 'GET', body, timeoutMs = 60_000, headers = {} } = options;
  const url = `${config.frontendBaseUrl}${pathName.startsWith('/') ? pathName : `/${pathName}`}`;
  return requestJson(url, {
    method,
    headers: {
      ...buildAppHeaders(config, cookieHeader, {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      }),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }, { timeoutMs });
}

export function findMessageInInbox(conversations, text, accountId) {
  for (const conversation of Array.isArray(conversations) ? conversations : []) {
    if (accountId && conversation?.accountId !== accountId) continue;
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
    const matchingMessages = messages.filter((message) => message?.text === text);
    if (matchingMessages.length > 0) {
      return {
        conversationId: conversation.conversationId,
        accountId: conversation.accountId,
        matchingCount: matchingMessages.length,
        participantName: conversation?.participant?.name || 'Unknown',
      };
    }
  }

  return null;
}

export async function pollUntil(label, fn, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = 5_000,
  } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`${label} was not observed within ${Math.ceil(timeoutMs / 1000)}s.`);
}

export async function findPersistedMessages(config, accountId, text) {
  const result = await queryDatabase(
    config,
    `SELECT id, "conversationId", "accountId", "senderId", "sentAt", "createdAt"
       FROM messages
      WHERE "accountId" = $1 AND text = $2
      ORDER BY "createdAt" DESC`,
    [accountId, text]
  );

  return result.rows;
}

export function sanitizeSummaryForPrint(summary) {
  return JSON.stringify(summary, null, 2);
}
