'use strict';

const { getRedis } = require('./redisClient');

// Conservative daily limits — well below LinkedIn detection thresholds
const LIMITS = {
  messagesSent:    25,
  connectRequests: 15,
  profileViews:    60,
  searchQueries:   40,
  inboxReads:      50,
};

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

  // Lua script ensures atomicity: INCR then EXPIRE only if counter == 1
  const current = await redis.eval(`
    local count = redis.call("INCR", KEYS[1])
    if count == 1 then
      redis.call("EXPIRE", KEYS[1], ARGV[1])
    end
    return count
  `, 1, key, secondsUntilMidnight + 60);

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
  const redis   = getRedis();
  const today   = todayKey();
  const actions = Object.keys(LIMITS);
  const keys    = actions.map((a) => `ratelimit:${accountId}:${a}:${today}`);
  const values  = await redis.mget(...keys); // single round-trip instead of N sequential GETs
  return Object.fromEntries(
    actions.map((action, i) => {
      const current = parseInt(values[i] || '0', 10);
      const limit   = LIMITS[action];
      return [action, { current, limit, remaining: Math.max(0, limit - current) }];
    })
  );
}

module.exports = { checkAndIncrement, getLimits };
