// FILE: lib/auth/jwt.ts
import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || '');
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE || '86400', 10);

export interface JWTPayload {
  authenticated: boolean;
  iat: number;
  exp: number;
  jti?: string; // JWT ID for blacklist tracking
}

/**
 * Sign a JWT token with session data
 */
export async function signToken(): Promise<string> {
  const jti = crypto.randomUUID(); // Unique token ID for revocation
  
  return await new SignJWT({ 
    authenticated: true,
    jti 
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(JWT_SECRET);
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}
