import { NextRequest } from 'next/server';
import { Redis } from 'ioredis';

const WINDOW_SECONDS = Math.max(60, parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_SEC || '900', 10) || 900);
const MAX_ATTEMPTS = Math.max(1, parseInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || '5', 10) || 5);
const KEY_PREFIX = 'auth:login:attempts:';

let redis: Redis | null = null;
let redisConnectPromise: Promise<boolean> | null = null;
let redisUnavailableUntil = 0;
const memoryFallback = new Map<string, { count: number; resetAt: number }>();

function isRedisDisabled(): boolean {
  return process.env.DISABLE_REDIS === '1';
}

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL?.trim();
  const options = {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1 as const,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: () => null,
  };

  const client = url
    ? new Redis(url, options)
    : new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        ...options,
      });

  client.on('error', () => {
    redisUnavailableUntil = Date.now() + 60_000;
  });

  return client;
}

function resetRedisClient(client?: Redis | null): void {
  redisConnectPromise = null;
  if (client) {
    try {
      client.disconnect();
    } catch {}
  }
  if (!client || redis === client) {
    redis = null;
  }
}

async function ensureRedisConnected(client: Redis): Promise<boolean> {
  if (client.status === 'ready') {
    return true;
  }

  if (!redisConnectPromise) {
    redisConnectPromise = client.connect()
      .then(() => true)
      .catch(() => {
        redisUnavailableUntil = Date.now() + 60_000;
        resetRedisClient(client);
        return false;
      })
      .finally(() => {
        redisConnectPromise = null;
      });
  }

  return redisConnectPromise;
}

async function getRedis(): Promise<Redis | null> {
  if (isRedisDisabled() || Date.now() < redisUnavailableUntil) {
    return null;
  }

  if (!redis) {
    redis = createRedisClient();
  }

  const connected = await ensureRedisConnected(redis);
  return connected ? redis : null;
}

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  ).trim();
}

function getKey(req: NextRequest): string {
  return `${KEY_PREFIX}${getClientIp(req)}`;
}

function purgeMemoryEntry(key: string): { count: number; resetAt: number } | null {
  const entry = memoryFallback.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.resetAt) {
    memoryFallback.delete(key);
    return null;
  }
  return entry;
}

async function consumeMemoryAttempt(key: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const existing = purgeMemoryEntry(key);
  const resetAt = existing?.resetAt || (Date.now() + WINDOW_SECONDS * 1000);
  const count = (existing?.count || 0) + 1;
  memoryFallback.set(key, { count, resetAt });

  return {
    allowed: count <= MAX_ATTEMPTS,
    retryAfterSec: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

export async function consumeLoginAttempt(req: NextRequest): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const key = getKey(req);
  const redisClient = await getRedis();

  if (!redisClient) {
    return consumeMemoryAttempt(key);
  }

  try {
    const result = await redisClient.eval(
      `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      local ttl = redis.call('TTL', KEYS[1])
      return {current, ttl}
      `,
      1,
      key,
      WINDOW_SECONDS
    ) as [number, number];

    const count = Number(result?.[0] || 0);
    const ttl = Math.max(1, Number(result?.[1] || WINDOW_SECONDS));
    return {
      allowed: count <= MAX_ATTEMPTS,
      retryAfterSec: ttl,
    };
  } catch {
    redisUnavailableUntil = Date.now() + 60_000;
    resetRedisClient(redisClient);
    return consumeMemoryAttempt(key);
  }
}

export async function clearLoginAttempts(req: NextRequest): Promise<void> {
  const key = getKey(req);
  memoryFallback.delete(key);

  const redisClient = await getRedis();
  if (!redisClient) return;

  try {
    await redisClient.del(key);
  } catch {
    redisUnavailableUntil = Date.now() + 60_000;
    resetRedisClient(redisClient);
  }
}
