import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('account access configuration helper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('warns when neither admin emails nor user mappings are configured', async () => {
    const { getAccountAccessStartupCheck } = await import('@/lib/auth/account-access-config');

    expect(getAccountAccessStartupCheck()).toEqual({
      id: 'account-access-config',
      label: 'account-access-config',
      title: 'Account access configuration',
      status: 'warn',
      accountAccessConfigPresent: false,
      initialAdminEmailsConfigured: false,
      initialAdminEmailsCount: 0,
      userAccountAccessConfigured: false,
      userAccountAccessMappingCount: 0,
      detail: 'Neither INITIAL_ADMIN_EMAILS nor USER_ACCOUNT_ACCESS is configured in the frontend runtime environment.',
    });
  });

  it('passes when admin emails are configured', async () => {
    vi.stubEnv('INITIAL_ADMIN_EMAILS', 'admin@example.com');
    const { getAccountAccessStartupCheck } = await import('@/lib/auth/account-access-config');

    expect(getAccountAccessStartupCheck().status).toBe('pass');
  });

  it('passes when user account mappings are configured', async () => {
    vi.stubEnv('USER_ACCOUNT_ACCESS', JSON.stringify({
      'user@example.com': ['saikanchi130'],
    }));
    const { getAccountAccessStartupCheck } = await import('@/lib/auth/account-access-config');

    expect(getAccountAccessStartupCheck().status).toBe('pass');
  });
});
