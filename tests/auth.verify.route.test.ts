import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUserById: vi.fn(),
  resolveAllowedAccountIdsForUser: vi.fn(),
  getAccountAccessStartupCheck: vi.fn(),
  signToken: vi.fn(),
  shouldUseSecureCookie: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: mocks.getSession,
}));

vi.mock('@/lib/models/user', () => ({
  getUserById: mocks.getUserById,
  getEffectiveUserRole: (role: string | undefined, email: string | undefined) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (String(role || '').trim().toLowerCase() === 'admin') {
      return 'admin';
    }
    const configured = String(process.env.INITIAL_ADMIN_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return configured.includes(normalizedEmail) ? 'admin' : 'user';
  },
}));

vi.mock('@/lib/auth/account-access', () => ({
  resolveAllowedAccountIdsForUser: mocks.resolveAllowedAccountIdsForUser,
}));

vi.mock('@/lib/auth/account-access-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account-access-config')>();
  return {
    ...actual,
    getAccountAccessStartupCheck: mocks.getAccountAccessStartupCheck,
  };
});

vi.mock('@/lib/auth/jwt', () => ({
  signToken: mocks.signToken,
}));

vi.mock('@/lib/auth/cookie', () => ({
  shouldUseSecureCookie: mocks.shouldUseSecureCookie,
}));

function makeRequest() {
  return new NextRequest('http://localhost/api/auth/verify', {
    method: 'GET',
    headers: {
      origin: 'http://localhost:3000',
      referer: 'http://localhost:3000/',
    },
  });
}

describe('/api/auth/verify', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.getSession.mockReset();
    mocks.getUserById.mockReset();
    mocks.resolveAllowedAccountIdsForUser.mockReset();
    mocks.getAccountAccessStartupCheck.mockReset();
    mocks.signToken.mockReset();
    mocks.shouldUseSecureCookie.mockReset();

    mocks.getAccountAccessStartupCheck.mockReturnValue({
      id: 'account-access-config',
      label: 'account-access-config',
      title: 'Account access configuration',
      status: 'pass',
      accountAccessConfigPresent: true,
      initialAdminEmailsConfigured: true,
      initialAdminEmailCount: 1,
      userAccountAccessConfigured: true,
      userAccountAccessEntryCount: 1,
      detail: 'Configured admin emails: 1; user account mappings: 1',
    });
    mocks.resolveAllowedAccountIdsForUser.mockResolvedValue(new Set(['saikanchi130']));
    mocks.shouldUseSecureCookie.mockReturnValue(false);
    mocks.signToken.mockResolvedValue('fresh-token');
  });

  it('returns safe diagnostics for the current authenticated user', async () => {
    mocks.getSession.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      email: 'mapped@example.com',
      role: 'user',
      name: 'Mapped User',
      authMode: 'user',
    });
    mocks.getUserById.mockResolvedValue({
      id: 'user-1',
      email: 'mapped@example.com',
      role: 'user',
      name: 'Mapped User',
    });

    const { GET } = await import('@/app/api/auth/verify/route');
    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.user).toEqual({
      id: 'user-1',
      email: 'mapped@example.com',
      role: 'user',
      name: 'Mapped User',
      authMode: 'user',
    });
    expect(payload.diagnostics).toEqual({
      session: {
        email: 'mapped@example.com',
        role: 'user',
        authMode: 'user',
      },
      accountAccess: {
        accountAccessConfigPresent: true,
        initialAdminEmailsConfigured: true,
        initialAdminEmailCount: 1,
        userAccountAccessConfigured: true,
        userAccountAccessEntryCount: 1,
        mappedAccountIds: ['saikanchi130'],
        effectiveRole: 'user',
      },
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refreshes a stale session cookie when effective role changes', async () => {
    vi.stubEnv('INITIAL_ADMIN_EMAILS', 'admin@example.com');
    mocks.getSession.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      email: 'admin@example.com',
      role: 'user',
      name: 'Admin User',
      authMode: 'user',
    });
    mocks.getUserById.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'user',
      name: 'Admin User',
    });
    mocks.resolveAllowedAccountIdsForUser.mockResolvedValue(new Set());

    const { GET } = await import('@/app/api/auth/verify/route');
    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.user.role).toBe('admin');
    expect(mocks.signToken).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'admin',
      name: 'Admin User',
      email: 'admin@example.com',
      authMode: 'user',
    });
    expect(response.headers.get('set-cookie')).toContain('app_session=fresh-token');
  });
});
