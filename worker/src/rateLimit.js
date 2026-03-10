import redis from './redisClient.js';

const LIMITS = {
    profileView: 80,
    messagesSent: 30,
    connectRequests: 20,
    searchQueries: 50,
    messagesRead: 100,
};

const INCR_WITH_EXPIRE_LUA = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], 86400)
  end
  return current
`;

export const checkAndIncrement = async (accountId, action) => {
    const dateStr = new Date().toISOString().split('T')[0];
    const key = `ratelimit:${accountId}:${action}:${dateStr}`;

    const current = await redis.eval(INCR_WITH_EXPIRE_LUA, 1, key);

    const limit = LIMITS[action] || 0;
    if (current > limit) {
        throw new Error(`Rate limit exceeded: ${action} ${current}/${limit}`);
    }

    return { current, limit, remaining: limit - current };
};

export const getRateLimitStatus = async (accountId) => {
    const dateStr = new Date().toISOString().split('T')[0];
    const status = {};

    for (const action of Object.keys(LIMITS)) {
        const key = `ratelimit:${accountId}:${action}:${dateStr}`;
        const val = await redis.get(key);
        status[action] = parseInt(val || '0', 10);
    }
    return status;
};
