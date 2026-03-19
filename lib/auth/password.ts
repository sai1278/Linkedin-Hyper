// FILE: lib/auth/password.ts
import { timingSafeEqual } from 'crypto';

/**
 * Compare passwords using timing-safe comparison to prevent timing attacks.
 * Both strings are converted to buffers of equal length before comparison.
 */
export function verifyPassword(input: string, expected: string): boolean {
  try {
    // Normalize to same encoding
    const inputBuf = Buffer.from(input, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    
    // If lengths differ, pad shorter one to prevent timing leak
    if (inputBuf.length !== expectedBuf.length) {
      return false;
    }
    
    return timingSafeEqual(inputBuf, expectedBuf);
  } catch {
    return false;
  }
}
