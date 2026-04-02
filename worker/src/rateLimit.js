'use strict';

const { getRedis } = require('./redisClient');

// Conservative daily limits — well below LinkedIn detection thresholds
const toPositiveInt = (value, fallback) => {
  const parsed = parseInt(String(value ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

// Conservative daily limits; can be tuned with env variables in production.
const LIMITS = {
  messagesSent:    toPositiveInt(process.env.RATE_LIMIT_MESSAGES_SENT, 25),
  connectRequests: toPositiveInt(process.env.RATE_LIMIT_CONNECT_REQUESTS, 15),
  profileViews:    toPositiveInt(process.env.RATE_LIMIT_PROFILE_VIEWS, 60),
  searchQueries:   toPositiveInt(process.env.RATE_LIMIT_SEARCH_QUERIES, 40),
  // 50/day is too low for dashboard polling + manual refreshes.
  inboxReads:      toPositiveInt(process.env.RATE_LIMIT_INBOX_READS, 500),
};

// Local fallback for dev mode when Redis is unavailable.
const memoryCounters = new Map();
let cachedRedis = null;

function getRateLimitRedis() {
  if (!cachedRedis) {
    cachedRedis = getRedis();
  }
  return cachedRedis;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

/**
 * Atomically increment counter and check against limit.
 * Throws if limit exceeded.
 */
async function checkAndIncrement(accountId, action) {
  const limit = LIMITS[action];
  if (limit === undefined) throw new Error(`Unknown rate-limit action: ${action}`);

  const secondsUntilMidnight = 86400 - (Math.floor(Date.now() / 1000) % 86400);
  const key = `ratelimit:${accountId}:${action}:${todayKey()}`;

  let current;
  try {
    const redis = getRateLimitRedis();
    // Lua script ensures atomicity: INCR then EXPIRE only if counter == 1
    current = await redis.eval(`
      local count = redis.call("INCR", KEYS[1])
      if count == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
      end
      return count
    `, 1, key, secondsUntilMidnight + 60);
  } catch (err) {
    // Dev fallback when Redis is not running.
    const prev = memoryCounters.get(key) || 0;
    current = prev + 1;
    memoryCounters.set(key, current);
  }

  if (current > limit) {
    const err = new Error(
      `Daily limit reached: ${action} (${current}/${limit}) for account ${accountId}`
    );
    err.code   = 'RATE_LIMIT_EXCEEDED';
    err.status = 429;
    throw err;
  }

  return { current, limit, remaining: limit - current };
}

async function getLimits(accountId) {
  const today   = todayKey();
  const actions = Object.keys(LIMITS);
  const keys    = actions.map((a) => `ratelimit:${accountId}:${a}:${today}`);
  let values;

  try {
    const redis = getRateLimitRedis();
    // Single round-trip instead of N sequential GETs.
    values = await redis.mget(...keys);
  } catch (_err) {
    values = keys.map((k) => String(memoryCounters.get(k) || 0));
  }

  return Object.fromEntries(
    actions.map((action, i) => {
      const current = parseInt(values[i] || '0', 10);
      const limit   = LIMITS[action];
      return [action, { current, limit, remaining: Math.max(0, limit - current) }];
    })
  );
}

module.exports = { checkAndIncrement, getLimits };
