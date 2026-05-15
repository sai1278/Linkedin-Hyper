import { beforeEach, describe, expect, it, vi } from 'vitest';

function expectAccountAccessStartupCheck(
  actual: ReturnType<typeof import('@/lib/auth/account-access-config')['getAccountAccessStartupCheck']>,
  expected: {
    status: 'pass' | 'warn';
    detail: string;
    initialAdminEmailsConfigured: boolean;
    userAccountAccessConfigured: boolean;
    accountAccessConfigPresent?: boolean;
    initialAdminEmailCount?: number;
    userAccountAccessEntryCount?: number;
  }
) {
  expect(actual).toEqual(
    expect.objectContaining({
      id: 'account-access-config',
      label: 'account-access-config',
      title: 'Account access configuration',
      status: expected.status,
      detail: expected.detail,
      initialAdminEmailsConfigured: expected.initialAdminEmailsConfigured,
      userAccountAccessConfigured: expected.userAccountAccessConfigured,
      ...(expected.accountAccessConfigPresent !== undefined
        ? { accountAccessConfigPresent: expected.accountAccessConfigPresent }
        : {}),
      ...(expected.initialAdminEmailCount !== undefined
        ? { initialAdminEmailCount: expected.initialAdminEmailCount }
        : {}),
      ...(expected.userAccountAccessEntryCount !== undefined
        ? { userAccountAccessEntryCount: expected.userAccountAccessEntryCount }
        : {}),
    })
  );

  expect(Object.keys(actual)).toEqual(
    expect.arrayContaining([
      'id',
      'label',
      'title',
      'status',
      'detail',
      'initialAdminEmailsConfigured',
      'userAccountAccessConfigured',
    ])
  );
}

describe('account access configuration helper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('INITIAL_ADMIN_EMAILS', '');
    vi.stubEnv('USER_ACCOUNT_ACCESS', '');
    vi.stubEnv('ACCOUNT_ACCESS_MAP', '');
  });

  it('warns when neither admin emails nor user mappings are configured', async () => {
    const { getAccountAccessStartupCheck } = await import('@/lib/auth/account-access-config');

    expectAccountAccessStartupCheck(getAccountAccessStartupCheck(), {
      status: 'warn',
      accountAccessConfigPresent: false,
      initialAdminEmailsConfigured: false,
      initialAdminEmailCount: 0,
      userAccountAccessConfigured: false,
      userAccountAccessEntryCount: 0,
      detail:
        'Neither INITIAL_ADMIN_EMAILS nor USER_ACCOUNT_ACCESS is configured in the frontend runtime environment.',
    });
  });

  it('passes when admin emails are configured', async () => {
    vi.stubEnv('INITIAL_ADMIN_EMAILS', 'admin@example.com');
    const { getAccountAccessStartupCheck } = await import('@/lib/auth/account-access-config');

    expectAccountAccessStartupCheck(getAccountAccessStartupCheck(), {
      status: 'pass',
      accountAccessConfigPresent: true,
      initialAdminEmailsConfigured: true,
      initialAdminEmailCount: 1,
      userAccountAccessConfigured: false,
      userAccountAccessEntryCount: 0,
      detail: 'Configured admin emails: 1; user account mappings: 0',
    });
  });

  it('passes when user account mappings are configured', async () => {
    vi.stubEnv('USER_ACCOUNT_ACCESS', JSON.stringify({
      'user@example.com': ['saikanchi130'],
    }));
    const { getAccountAccessStartupCheck } = await import('@/lib/auth/account-access-config');

    expectAccountAccessStartupCheck(getAccountAccessStartupCheck(), {
      status: 'pass',
      accountAccessConfigPresent: true,
      initialAdminEmailsConfigured: false,
      initialAdminEmailCount: 0,
      userAccountAccessConfigured: true,
      userAccountAccessEntryCount: 1,
      detail: 'Configured admin emails: 0; user account mappings: 1',
    });
  });
});
