import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bcryptCompare: vi.fn(),
  signToken: vi.fn(),
  shouldUseSecureCookie: vi.fn(),
  enforceMutationProtection: vi.fn(),
  consumeLoginAttempt: vi.fn(),
  clearLoginAttempts: vi.fn(),
  getUserByEmail: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('bcrypt', () => ({
  default: {
    compare: mocks.bcryptCompare,
  },
  compare: mocks.bcryptCompare,
}));

vi.mock('@/lib/auth/jwt', () => ({
  signToken: mocks.signToken,
}));

vi.mock('@/lib/auth/cookie', () => ({
  shouldUseSecureCookie: mocks.shouldUseSecureCookie,
}));

vi.mock('@/lib/server/backend-api', () => ({
  enforceMutationProtection: mocks.enforceMutationProtection,
}));

vi.mock('@/lib/auth/login-rate-limit', () => ({
  consumeLoginAttempt: mocks.consumeLoginAttempt,
  clearLoginAttempts: mocks.clearLoginAttempts,
}));

vi.mock('@/lib/models/user', () => ({
  getUserByEmail: mocks.getUserByEmail,
}));

vi.mock('@/lib/server/logger', () => ({
  serverLogger: {
    child: () => ({
      error: mocks.loggerError,
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      child: () => ({
        error: mocks.loggerError,
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      }),
    }),
  },
}));

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('auth login route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    mocks.consumeLoginAttempt.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
    mocks.clearLoginAttempts.mockResolvedValue(undefined);
    mocks.enforceMutationProtection.mockReturnValue(null);
    mocks.shouldUseSecureCookie.mockReturnValue(false);
    mocks.signToken.mockResolvedValue('signed-token');
    mocks.bcryptCompare.mockReset();
    mocks.getUserByEmail.mockReset();
  });

  it('requires both email and password', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const response = await POST(makeRequest({ password: 'secret' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Email and password are required',
    });
  });

  it('rejects invalid credentials without shared-password fallback', async () => {
    mocks.getUserByEmail.mockResolvedValue(null);

    const { POST } = await import('@/app/api/auth/login/route');
    const response = await POST(makeRequest({
      email: 'admin@example.com',
      password: 'legacy-secret',
    }));

    expect(response.status).toBe(401);
    expect(mocks.signToken).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid email or password',
    });
  });

  it('signs in with the DB-backed user role only', async () => {
    mocks.getUserByEmail.mockResolvedValue({
      id: 'user-1',
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin',
      password_hash: 'hashed-password',
    });
    mocks.bcryptCompare.mockResolvedValue(true);

    const { POST } = await import('@/app/api/auth/login/route');
    const response = await POST(makeRequest({
      email: 'admin@example.com',
      password: 'correct-horse-battery-staple',
      rememberMe: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.bcryptCompare).toHaveBeenCalledWith(
      'correct-horse-battery-staple',
      'hashed-password'
    );
    expect(mocks.signToken).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'admin',
      name: 'Admin User',
      email: 'admin@example.com',
      authMode: 'user',
    });

    const payload = await response.json();
    expect(payload.user).toMatchObject({
      id: 'user-1',
      role: 'admin',
      authMode: 'user',
    });
    expect(response.cookies.get('app_session')?.value).toBe('signed-token');
  });
});
