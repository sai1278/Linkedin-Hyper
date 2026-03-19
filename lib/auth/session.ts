// FILE: lib/auth/session.ts
import { NextRequest } from 'next/server';
import { verifyToken, type JWTPayload } from './jwt';
import { Redis } from 'ioredis';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || '');
  }
  return redis;
}

/**
 * Extract and verify session from request cookies
 */
export async function getSession(req: NextRequest): Promise<JWTPayload | null> {
  const token = req.cookies.get('app_session')?.value;
  if (!token) return null;
  
  const payload = await verifyToken(token);
  if (!payload) return null;
  
  // Check if token is blacklisted (for logout)
  if (payload.jti) {
    const redisClient = getRedis();
    const isBlacklisted = await redisClient.get(`jwt:blacklist:${payload.jti}`);
    if (isBlacklisted) return null;
  }
  
  return payload;
}

/**
 * Blacklist a JWT token (for logout)
 */
export async function blacklistToken(jti: string, expiresIn: number): Promise<void> {
  const redisClient = getRedis();
  await redisClient.setex(`jwt:blacklist:${jti}`, expiresIn, '1');
}
