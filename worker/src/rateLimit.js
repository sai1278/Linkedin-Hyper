'use strict';

const { getRedis } = require('./redisClient');
const { recordRateLimitBlocked } = require('./utils/metrics');

const DAY_SECONDS = 86400;
const HOUR_SECONDS = 3600;

const toPositiveInt = (value, fallback) => {
  const parsed = parseInt(String(value ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

const LIMITS = {
  messagesSent:    toPositiveInt(process.env.RATE_LIMIT_MESSAGES_SENT, 25),
  connectRequests: toPositiveInt(process.env.RATE_LIMIT_CONNECT_REQUESTS, 15),
  profileViews:    toPositiveInt(process.env.RATE_LIMIT_PROFILE_VIEWS, 60),
  searchQueries:   toPositiveInt(process.env.RATE_LIMIT_SEARCH_QUERIES, 40),
  inboxReads:      toPositiveInt(process.env.RATE_LIMIT_INBOX_READS, 500),
};

const MESSAGE_SEND_POLICY = {
  dailyLimit: LIMITS.messagesSent,
  hourlyLimit: toPositiveInt(process.env.RATE_LIMIT_MESSAGES_SENT_HOURLY, 8),
  minGapSeconds: toPositiveInt(process.env.RATE_LIMIT_MESSAGES_SENT_MIN_GAP_SEC, 45),
  burstLimit: toPositiveInt(process.env.RATE_LIMIT_MESSAGES_SENT_BURST_LIMIT, 3),
  burstWindowSeconds: toPositiveInt(process.env.RATE_LIMIT_MESSAGES_SENT_BURST_WINDOW_SEC, 300),
  historyTtlSeconds: toPositiveInt(process.env.RATE_LIMIT_MESSAGES_SENT_HISTORY_TTL_SEC, DAY_SECONDS + HOUR_SECONDS),
};

const memoryCounters = new Map();
let cachedRedis = null;

function getRateLimitRedis() {
  if (!cachedRedis) {
    cachedRedis = getRedis();
  }
  return cachedRedis;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getNextUtcMidnightMs() {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
}

function buildRateLimitError(message, retryAfterSec) {
  const err = new Error(message);
  err.code = 'RATE_LIMIT_EXCEEDED';
  err.status = 429;
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    err.retryAfterSec = retryAfterSec;
  }
  return err;
}

function sanitizeTimestampHistory(history, cutoffSec) {
  if (!Array.isArray(history)) return [];

  return history
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value > cutoffSec)
    .sort((left, right) => left - right);
}

async function readTimestampHistory(redis, key) {
  try {
    const raw = await redis.get(key);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeTimestampHistory(redis, key, timestamps, ttlSeconds) {
  await redis.set(key, JSON.stringify(timestamps), 'EX', ttlSeconds);
}

async function checkSimpleDailyLimit(accountId, action) {
  const limit = LIMITS[action];
  if (limit === undefined) throw new Error(`Unknown rate-limit action: ${action}`);

  const secondsUntilMidnight = DAY_SECONDS - (Math.floor(Date.now() / 1000) % DAY_SECONDS);
  const key = `ratelimit:${accountId}:${action}:${todayKey()}`;

  let current;
  try {
    const redis = getRateLimitRedis();
    current = await redis.eval(`
      local count = redis.call("INCR", KEYS[1])
      if count == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
      end
      return count
    `, 1, key, secondsUntilMidnight + 60);
  } catch (_err) {
    const prev = memoryCounters.get(key) || 0;
    current = prev + 1;
    memoryCounters.set(key, current);
  }

  if (current > limit) {
    recordRateLimitBlocked(accountId, `${action.toUpperCase()}_DAILY_LIMIT`);
    throw buildRateLimitError(
      `Daily limit reached: ${action} (${current}/${limit}) for account ${accountId}`,
      secondsUntilMidnight
    );
  }

  return {
    current,
    limit,
    remaining: limit - current,
    resetsAt: Date.now() + (secondsUntilMidnight * 1000),
  };
}

async function checkMessageSendLimit(accountId) {
  const redis = getRateLimitRedis();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const historyKey = `ratelimit:${accountId}:messagesSent:history`;
  const cutoffSec = nowSec - DAY_SECONDS;
  const history = sanitizeTimestampHistory(await readTimestampHistory(redis, historyKey), cutoffSec);

  const lastSentSec = history.length > 0 ? history[history.length - 1] : 0;
  if (lastSentSec > 0) {
    const secondsSinceLastSend = nowSec - lastSentSec;
    if (secondsSinceLastSend < MESSAGE_SEND_POLICY.minGapSeconds) {
      const retryAfterSec = MESSAGE_SEND_POLICY.minGapSeconds - secondsSinceLastSend;
      recordRateLimitBlocked(accountId, 'SEND_COOLDOWN');
      throw buildRateLimitError(
        `Send cooldown active for account ${accountId}. Wait ${retryAfterSec}s before sending again.`,
        retryAfterSec
      );
    }
  }

  const hourlyCount = history.filter((timestamp) => timestamp > nowSec - HOUR_SECONDS).length;
  if (hourlyCount >= MESSAGE_SEND_POLICY.hourlyLimit) {
    const retryAfterSec = Math.max(1, HOUR_SECONDS - (nowSec - history[history.length - hourlyCount]));
    recordRateLimitBlocked(accountId, 'SEND_HOURLY_LIMIT');
    throw buildRateLimitError(
      `Hourly send limit reached (${hourlyCount}/${MESSAGE_SEND_POLICY.hourlyLimit}) for account ${accountId}`,
      retryAfterSec
    );
  }

  const burstCount = history.filter((timestamp) => timestamp > nowSec - MESSAGE_SEND_POLICY.burstWindowSeconds).length;
  if (burstCount >= MESSAGE_SEND_POLICY.burstLimit) {
    const burstAnchor = history[history.length - burstCount];
    const retryAfterSec = Math.max(1, MESSAGE_SEND_POLICY.burstWindowSeconds - (nowSec - burstAnchor));
    recordRateLimitBlocked(accountId, 'SEND_BURST_LIMIT');
    throw buildRateLimitError(
      `Burst protection triggered for account ${accountId}. Wait ${retryAfterSec}s before sending another message.`,
      retryAfterSec
    );
  }

  if (history.length >= MESSAGE_SEND_POLICY.dailyLimit) {
    const retryAfterSec = Math.max(1, Math.floor((getNextUtcMidnightMs() - nowMs) / 1000));
    recordRateLimitBlocked(accountId, 'SEND_DAILY_LIMIT');
    throw buildRateLimitError(
      `Daily send limit reached (${history.length}/${MESSAGE_SEND_POLICY.dailyLimit}) for account ${accountId}`,
      retryAfterSec
    );
  }

  const nextHistory = [...history, nowSec];
  await writeTimestampHistory(redis, historyKey, nextHistory, MESSAGE_SEND_POLICY.historyTtlSeconds);

  return {
    current: nextHistory.length,
    limit: MESSAGE_SEND_POLICY.dailyLimit,
    remaining: Math.max(0, MESSAGE_SEND_POLICY.dailyLimit - nextHistory.length),
    resetsAt: getNextUtcMidnightMs(),
    hourly: {
      current: hourlyCount + 1,
      limit: MESSAGE_SEND_POLICY.hourlyLimit,
      remaining: Math.max(0, MESSAGE_SEND_POLICY.hourlyLimit - (hourlyCount + 1)),
    },
    burst: {
      current: burstCount + 1,
      limit: MESSAGE_SEND_POLICY.burstLimit,
      windowSeconds: MESSAGE_SEND_POLICY.burstWindowSeconds,
    },
    minGapSeconds: MESSAGE_SEND_POLICY.minGapSeconds,
    nextAllowedAt: Date.now() + (MESSAGE_SEND_POLICY.minGapSeconds * 1000),
  };
}

async function checkAndIncrement(accountId, action) {
  if (action === 'messagesSent') {
    return checkMessageSendLimit(accountId);
  }

  return checkSimpleDailyLimit(accountId, action);
}

async function getMessageSendLimits(accountId) {
  const redis = getRateLimitRedis();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const history = sanitizeTimestampHistory(
    await readTimestampHistory(redis, `ratelimit:${accountId}:messagesSent:history`),
    nowSec - DAY_SECONDS
  );
  const hourlyCount = history.filter((timestamp) => timestamp > nowSec - HOUR_SECONDS).length;
  const burstCount = history.filter((timestamp) => timestamp > nowSec - MESSAGE_SEND_POLICY.burstWindowSeconds).length;
  const lastSentSec = history.length > 0 ? history[history.length - 1] : 0;
  const retryAfterSec = lastSentSec > 0
    ? Math.max(0, MESSAGE_SEND_POLICY.minGapSeconds - (nowSec - lastSentSec))
    : 0;

  return {
    current: history.length,
    limit: MESSAGE_SEND_POLICY.dailyLimit,
    remaining: Math.max(0, MESSAGE_SEND_POLICY.dailyLimit - history.length),
    resetsAt: getNextUtcMidnightMs(),
    hourly: {
      current: hourlyCount,
      limit: MESSAGE_SEND_POLICY.hourlyLimit,
      remaining: Math.max(0, MESSAGE_SEND_POLICY.hourlyLimit - hourlyCount),
    },
    burst: {
      current: burstCount,
      limit: MESSAGE_SEND_POLICY.burstLimit,
      windowSeconds: MESSAGE_SEND_POLICY.burstWindowSeconds,
    },
    minGapSeconds: MESSAGE_SEND_POLICY.minGapSeconds,
    nextAllowedAt: retryAfterSec > 0 ? nowMs + (retryAfterSec * 1000) : nowMs,
  };
}

async function getSimpleDailyLimits(accountId, action) {
  const today = todayKey();
  const key = `ratelimit:${accountId}:${action}:${today}`;
  let current;

  try {
    const redis = getRateLimitRedis();
    current = Number.parseInt((await redis.get(key)) || '0', 10) || 0;
  } catch (_err) {
    current = Number.parseInt(String(memoryCounters.get(key) || 0), 10) || 0;
  }

  const limit = LIMITS[action];
  return {
    current,
    limit,
    remaining: Math.max(0, limit - current),
  };
}

async function getLimits(accountId) {
  const actions = Object.keys(LIMITS);
  const entries = await Promise.all(
    actions.map(async (action) => {
      if (action === 'messagesSent') {
        return [action, await getMessageSendLimits(accountId)];
      }
      return [action, await getSimpleDailyLimits(accountId, action)];
    })
  );

  return Object.fromEntries(entries);
}

module.exports = { checkAndIncrement, getLimits };
