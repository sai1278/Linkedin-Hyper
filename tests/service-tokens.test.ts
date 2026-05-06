import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('service token validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('accepts hashed service tokens with unexpired metadata', async () => {
    const rawToken = 'hashed-token-value';
    vi.stubEnv('SERVICE_AUTH_TOKENS', JSON.stringify([{
      id: 'svc-proxy-1',
      role: 'admin',
      tokenHash: sha256Hex(rawToken),
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      rotatedAt: null,
      audiences: ['proxy'],
    }]));

    const { authenticateServiceToken } = await import('@/lib/auth/service-tokens');
    const result = authenticateServiceToken(rawToken, 'proxy');

    expect(result).toEqual({
      ok: true,
      token: {
        id: 'svc-proxy-1',
        role: 'admin',
        expiresAt: '2099-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        rotatedAt: null,
        audiences: ['proxy'],
        kind: 'hashed',
      },
    });
  });

  it('rejects expired hashed service tokens', async () => {
    const rawToken = 'expired-token-value';
    vi.stubEnv('SERVICE_AUTH_TOKENS', JSON.stringify([{
      id: 'svc-proxy-expired',
      role: 'user',
      tokenHash: sha256Hex(rawToken),
      expiresAt: '2000-01-01T00:00:00.000Z',
      audiences: ['proxy'],
    }]));

    const { authenticateServiceToken } = await import('@/lib/auth/service-tokens');
    expect(authenticateServiceToken(rawToken, 'proxy')).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('keeps legacy static tokens disabled by default in production', async () => {
    vi.stubEnv('PROXY_AUTH_TOKENS', JSON.stringify({ 'legacy-token': 'user' }));
    vi.stubEnv('ALLOW_STATIC_SERVICE_TOKENS', 'false');

    const { authenticateServiceToken } = await import('@/lib/auth/service-tokens');
    expect(authenticateServiceToken('legacy-token', 'proxy')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});
