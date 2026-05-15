import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedActor: vi.fn(),
  getUserById: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/server/backend-api', () => ({
  getAuthenticatedActor: mocks.getAuthenticatedActor,
}));

vi.mock('@/lib/models/user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/models/user')>();
  return {
    ...actual,
    getUserById: mocks.getUserById,
  };
});

vi.mock('@/lib/db', () => ({
  query: mocks.query,
}));

function makeRequest(url = 'http://localhost/api/inbox/unified') {
  return new NextRequest(url, {
    method: 'GET',
    headers: {
      origin: 'http://localhost:3000',
      referer: 'http://localhost:3000/',
    },
  });
}

describe('account access authorization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.getAuthenticatedActor.mockReset();
    mocks.getUserById.mockReset();
    mocks.query.mockReset();
    mocks.getAuthenticatedActor.mockResolvedValue({
      actor: {
        authenticated: true,
        kind: 'user-session',
        role: 'user',
        userId: 'user-1',
      },
    });
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it('allows configured admin emails to access all accounts', async () => {
    vi.stubEnv('INITIAL_ADMIN_EMAILS', 'admin@example.com');
    mocks.getUserById.mockResolvedValue({
      id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'user',
    });

    const { authorizeCollectionAccess, authorizeAccountAccess } = await import('@/lib/auth/account-access');
    const collection = await authorizeCollectionAccess(makeRequest());
    const single = await authorizeAccountAccess(makeRequest(), 'saikanchi130');

    expect(collection.response).toBeUndefined();
    expect(collection.actor?.role).toBe('admin');
    expect(single.response).toBeUndefined();
    expect(single.actor?.role).toBe('admin');
    expect(single.accountId).toBe('saikanchi130');
  });

  it('allows a non-admin user with a persisted account mapping', async () => {
    mocks.getUserById.mockResolvedValue({
      id: 'user-1',
      name: 'Mapped User',
      email: 'mapped@example.com',
      role: 'user',
    });
    mocks.query.mockImplementation(async (text: string) => {
      if (text.includes('FROM user_account_access')) {
        return { rows: [{ account_id: 'saikanchi130' }] };
      }
      if (text.includes('FROM conversations')) {
        return { rows: [{ id: 'thread-1', accountId: 'saikanchi130' }] };
      }
      return { rows: [] };
    });

    const {
      authorizeCollectionAccess,
      authorizeAccountAccess,
      authorizeConversationAccess,
    } = await import('@/lib/auth/account-access');

    const collection = await authorizeCollectionAccess(makeRequest());
    const single = await authorizeAccountAccess(makeRequest(), 'saikanchi130');
    const conversation = await authorizeConversationAccess(
      makeRequest('http://localhost/api/messages/thread?conversationId=thread-1'),
      'thread-1'
    );

    expect(collection.response).toBeUndefined();
    expect(Array.from(collection.allowedAccountIds || [])).toEqual(['saikanchi130']);
    expect(single.response).toBeUndefined();
    expect(single.accountId).toBe('saikanchi130');
    expect(conversation.response).toBeUndefined();
    expect(conversation.accountId).toBe('saikanchi130');
  });

  it('blocks a non-admin user with no account mapping', async () => {
    mocks.getUserById.mockResolvedValue({
      id: 'user-1',
      name: 'Blocked User',
      email: 'blocked@example.com',
      role: 'user',
    });
    mocks.query.mockResolvedValue({ rows: [] });

    const { authorizeCollectionAccess, authorizeAccountAccess } = await import('@/lib/auth/account-access');
    const collection = await authorizeCollectionAccess(makeRequest());
    const single = await authorizeAccountAccess(makeRequest(), 'saikanchi130');

    expect(collection.response?.status).toBe(403);
    expect(single.response?.status).toBe(403);
  });

  it('allows a non-admin user mapped through USER_ACCOUNT_ACCESS env', async () => {
    vi.stubEnv('USER_ACCOUNT_ACCESS', JSON.stringify({
      'mapped@example.com': ['saikanchi130'],
    }));
    mocks.getUserById.mockResolvedValue({
      id: 'user-1',
      name: 'Mapped User',
      email: 'mapped@example.com',
      role: 'user',
    });

    const { authorizeAccountAccess } = await import('@/lib/auth/account-access');
    const single = await authorizeAccountAccess(makeRequest(), 'saikanchi130');

    expect(single.response).toBeUndefined();
    expect(single.accountId).toBe('saikanchi130');
  });
});
