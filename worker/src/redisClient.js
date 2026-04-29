'use strict';

const Redis = require('ioredis');
const { EventEmitter } = require('events');
const { logger } = require('./utils/logger');
const { recordRedisError } = require('./utils/metrics');

let _redis = null;
let _memoryRedis = null;
const _memoryStrings = new Map();
const _memoryLists = new Map();
const _memorySets = new Map();
const _memoryExpiry = new Map();
const sharedRedisState = {
  label: 'shared',
  mode: 'network',
  status: 'idle',
  ready: false,
  reconnectDelayMs: null,
  lastReadyAt: null,
  lastError: null,
};
const dedicatedRedisStates = new Map();
let dedicatedRedisCounter = 0;

function isRedisDisabled() {
  return process.env.DISABLE_REDIS === '1';
}

function purgeExpiredKey(key) {
  const expiresAt = _memoryExpiry.get(key);
  if (!expiresAt) return;
  if (Date.now() < expiresAt) return;
  _memoryExpiry.delete(key);
  _memoryStrings.delete(key);
  _memoryLists.delete(key);
  _memorySets.delete(key);
}

function getStringValue(key) {
  purgeExpiredKey(key);
  return _memoryStrings.has(key) ? _memoryStrings.get(key) : null;
}

function setStringValue(key, value, ttlSeconds) {
  _memoryStrings.set(key, String(value));
  _memoryLists.delete(key);
  _memorySets.delete(key);
  if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
    _memoryExpiry.set(key, Date.now() + (ttlSeconds * 1000));
  } else {
    _memoryExpiry.delete(key);
  }
}

function getListValue(key) {
  purgeExpiredKey(key);
  const existing = _memoryLists.get(key);
  if (existing) return existing;
  const list = [];
  _memoryLists.set(key, list);
  _memoryStrings.delete(key);
  _memorySets.delete(key);
  return list;
}

function getSetValue(key) {
  purgeExpiredKey(key);
  const existing = _memorySets.get(key);
  if (existing) return existing;
  const set = new Set();
  _memorySets.set(key, set);
  _memoryStrings.delete(key);
  _memoryLists.delete(key);
  return set;
}

function createInMemoryRedis() {
  if (_memoryRedis) return _memoryRedis;

  const events = new EventEmitter();
  let client;

  const normalizeIndex = (idx, length, fallback) => {
    const parsed = Number.parseInt(String(idx), 10);
    if (Number.isNaN(parsed)) return fallback;
    return parsed >= 0 ? parsed : length + parsed;
  };

  client = {
    on(eventName, listener) {
      events.on(eventName, listener);
      return client;
    },
    once(eventName, listener) {
      events.once(eventName, listener);
      return client;
    },
    async get(key) {
      return getStringValue(key);
    },
    async mget(...keys) {
      return keys.map((key) => getStringValue(key));
    },
    async set(key, value, mode, ttlSeconds) {
      const hasExpiry = typeof mode === 'string' && mode.toUpperCase() === 'EX';
      const ttl = hasExpiry ? Number.parseInt(String(ttlSeconds), 10) : null;
      setStringValue(key, value, ttl);
      return 'OK';
    },
    async setex(key, ttlSeconds, value) {
      const ttl = Number.parseInt(String(ttlSeconds), 10);
      setStringValue(key, value, ttl);
      return 'OK';
    },
    async del(...keys) {
      let deleted = 0;
      for (const key of keys) {
        purgeExpiredKey(key);
        const hadKey = _memoryStrings.has(key) || _memoryLists.has(key) || _memorySets.has(key);
        _memoryStrings.delete(key);
        _memoryLists.delete(key);
        _memorySets.delete(key);
        _memoryExpiry.delete(key);
        if (hadKey) deleted += 1;
      }
      return deleted;
    },
    async incr(key) {
      const current = Number.parseInt(getStringValue(key) || '0', 10) || 0;
      const next = current + 1;
      setStringValue(key, String(next), null);
      return next;
    },
    async eval(_script, _numKeys, key, ttlSeconds) {
      const current = await client.incr(key);
      if (current === 1) {
        const ttl = Number.parseInt(String(ttlSeconds), 10);
        if (Number.isFinite(ttl) && ttl > 0) {
          _memoryExpiry.set(key, Date.now() + (ttl * 1000));
        }
      }
      return current;
    },
    async lpush(key, ...values) {
      const list = getListValue(key);
      for (const value of values) {
        list.unshift(String(value));
      }
      return list.length;
    },
    async ltrim(key, start, stop) {
      const list = getListValue(key);
      const len = list.length;
      if (len === 0) return 'OK';

      const normalizedStart = normalizeIndex(start, len, 0);
      const normalizedStop = normalizeIndex(stop, len, len - 1);

      const from = Math.max(0, normalizedStart);
      const to = Math.min(len - 1, normalizedStop);

      if (to < from) {
        _memoryLists.set(key, []);
        return 'OK';
      }

      _memoryLists.set(key, list.slice(from, to + 1));
      return 'OK';
    },
    async llen(key) {
      return getListValue(key).length;
    },
    async lrange(key, start, stop) {
      const list = getListValue(key);
      const len = list.length;
      if (len === 0) return [];

      const normalizedStart = normalizeIndex(start, len, 0);
      const normalizedStop = normalizeIndex(stop, len, len - 1);

      const from = Math.max(0, normalizedStart);
      const to = Math.min(len - 1, normalizedStop);
      if (to < from) return [];
      return list.slice(from, to + 1);
    },
    async sadd(key, ...members) {
      const set = getSetValue(key);
      let added = 0;
      for (const member of members) {
        const normalized = String(member);
        if (!set.has(normalized)) {
          set.add(normalized);
          added += 1;
        }
      }
      return added;
    },
    async srem(key, ...members) {
      const set = getSetValue(key);
      let removed = 0;
      for (const member of members) {
        const normalized = String(member);
        if (set.delete(normalized)) {
          removed += 1;
        }
      }
      return removed;
    },
    async smembers(key) {
      return Array.from(getSetValue(key));
    },
    async ping() {
      return 'PONG';
    },
    async quit() {
      return 'OK';
    },
    disconnect() {
      return;
    },
  };

  _memoryRedis = client;
  Object.assign(sharedRedisState, {
    mode: 'memory',
    status: 'ready',
    ready: true,
    reconnectDelayMs: null,
    lastReadyAt: Date.now(),
    lastError: null,
  });
  logger.warn('redis.memory_fallback.enabled', { mode: 'in-memory' });
  return _memoryRedis;
}

function getRedisRetryDelay(attemptNumber) {
  const attempt = Number.parseInt(String(attemptNumber || 0), 10) || 0;
  return Math.min(Math.max(attempt, 1) * 250, 5_000);
}

function sanitizeRedisError(error) {
  if (!error) return null;
  return {
    code: error.code || 'REDIS_ERROR',
    message: error.message || String(error),
  };
}

function attachRedisLifecycle(client, state, eventPrefix) {
  client.on('connect', () => {
    state.status = 'connecting';
    state.ready = false;
    state.reconnectDelayMs = null;
    logger.info(`${eventPrefix}.connecting`, { label: state.label });
  });

  client.on('ready', () => {
    state.status = 'ready';
    state.ready = true;
    state.reconnectDelayMs = null;
    state.lastReadyAt = Date.now();
    state.lastError = null;
    logger.info(`${eventPrefix}.ready`, { label: state.label });
  });

  client.on('reconnecting', (delayMs) => {
    state.status = 'reconnecting';
    state.ready = false;
    state.reconnectDelayMs = Number.isFinite(delayMs) ? delayMs : null;
    logger.warn(`${eventPrefix}.reconnecting`, {
      label: state.label,
      delayMs: state.reconnectDelayMs,
    });
  });

  client.on('close', () => {
    state.status = 'closed';
    state.ready = false;
    logger.warn(`${eventPrefix}.closed`, { label: state.label });
  });

  client.on('end', () => {
    state.status = 'ended';
    state.ready = false;
    logger.warn(`${eventPrefix}.ended`, { label: state.label });
  });

  client.on('error', (err) => {
    state.status = 'error';
    state.ready = false;
    state.lastError = sanitizeRedisError(err);
    recordRedisError(err?.code || 'REDIS_CONNECTION_ERROR');
    logger.error(`${eventPrefix}.error`, {
      label: state.label,
      errorCode: err?.code || 'REDIS_CONNECTION_ERROR',
      error: err,
    });
  });
}

function isClientReusable(client) {
  return Boolean(client) && !['end', 'close'].includes(String(client.status || '').toLowerCase());
}

/**
 * Returns the shared Redis connection.
 * Lazy-initialised so tests can set env vars before first use.
 */
function getRedis() {
  if (isRedisDisabled()) {
    return createInMemoryRedis();
  }

  if (_redis && isClientReusable(_redis)) return _redis;

  if (_redis && !isClientReusable(_redis)) {
    try {
      _redis.disconnect();
    } catch (_) {}
    _redis = null;
  }

  _redis = new Redis({
    host:     process.env.REDIS_HOST     || '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    // API routes should fail fast when Redis is unavailable so HTTP handlers
    // can degrade gracefully instead of hanging until frontend timeout.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    connectTimeout: 3000,
    commandTimeout: 3000,
    retryStrategy: getRedisRetryDelay,
    lazyConnect: false,
    enableReadyCheck: false,
  });
  sharedRedisState.mode = 'network';
  sharedRedisState.status = 'initializing';
  sharedRedisState.ready = false;
  attachRedisLifecycle(_redis, sharedRedisState, 'redis.shared');

  return _redis;
}

/**
 * Returns a new discrete Redis connection, required by BullMQ workers.
 */
function createRedisClient() {
  if (isRedisDisabled()) {
    throw new Error('Redis is disabled by DISABLE_REDIS=1. Set DISABLE_QUEUE=1 for local mode, or enable Redis for queue workers.');
  }

  const state = {
    label: `dedicated-${++dedicatedRedisCounter}`,
    mode: 'network',
    status: 'initializing',
    ready: false,
    reconnectDelayMs: null,
    lastReadyAt: null,
    lastError: null,
  };

  const client = new Redis({
    host:     process.env.REDIS_HOST     || '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    // BullMQ requires maxRetriesPerRequest to be null.
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    connectTimeout: 3000,
    retryStrategy: getRedisRetryDelay,
    lazyConnect: false,
    enableReadyCheck: false,
  });
  dedicatedRedisStates.set(state.label, state);
  attachRedisLifecycle(client, state, 'redis.client');
  client.on('end', () => {
    dedicatedRedisStates.delete(state.label);
  });

  return client;
}

function getRedisRuntimeState() {
  return {
    shared: {
      ...sharedRedisState,
    },
    dedicated: Array.from(dedicatedRedisStates.values()).map((state) => ({ ...state })),
  };
}

module.exports = { getRedis, createRedisClient, getRedisRuntimeState };
