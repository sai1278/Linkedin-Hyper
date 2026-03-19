'use strict';

const Redis = require('ioredis');

let _redis = null;

/**
 * Returns the shared Redis connection.
 * Lazy-initialised so tests can set env vars before first use.
 */
function getRedis() {
  if (_redis) return _redis;

  _redis = new Redis({
    host:     process.env.REDIS_HOST     || '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
  });

  _redis.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  return _redis;
}

/**
 * Returns a new discrete Redis connection, required by BullMQ workers.
 */
function createRedisClient() {
  const client = new Redis({
    host:     process.env.REDIS_HOST     || '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  client.on('error', (err) => {
    console.error('[Redis Client] Connection error:', err.message);
  });

  return client;
}

module.exports = { getRedis, createRedisClient };
