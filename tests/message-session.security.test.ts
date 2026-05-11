import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

const routeMocks = vi.hoisted(() => ({
  authenticateCaller: vi.fn(),
  forwardToBackend: vi.fn(),
  fetchBackendResponse: vi.fn(),
  authorizeAccountAccess: vi.fn(),
  authorizeCollectionAccess: vi.fn(),
  authorizeConversationAccess: vi.fn(),
  filterAccountScopedPayload: vi.fn((items: Array<{ accountId?: string }>, allowed: Set<string>) =>
    items.filter((item) => allowed.has(String(item?.accountId || '')))
  ),
}));

vi.mock('@/lib/server/backend-api', () => ({
  authenticateCaller: routeMocks.authenticateCaller,
  forwardToBackend: routeMocks.forwardToBackend,
  fetchBackendResponse: routeMocks.fetchBackendResponse,
  badRequest: (error: unknown) => NextResponse.json(
    { error: error instanceof Error ? error.message : 'Bad request' },
    { status: 400 }
  ),
  requireString: (value: string | null, name: string) => {
    if (!value || !String(value).trim()) {
      throw new Error(`Missing required field: ${name}`);
    }
    return String(value).trim();
  },
}));

vi.mock('@/lib/auth/account-access', () => ({
  authorizeAccountAccess: routeMocks.authorizeAccountAccess,
  authorizeCollectionAccess: routeMocks.authorizeCollectionAccess,
  authorizeConversationAccess: routeMocks.authorizeConversationAccess,
  filterAccountScopedPayload: routeMocks.filterAccountScopedPayload,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

function makeJsonRequest(url: string, body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      referer: 'http://localhost:3000/',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function makeGetRequest(url: string) {
  return new NextRequest(url, {
    method: 'GET',
    headers: {
      origin: 'http://localhost:3000',
      referer: 'http://localhost:3000/',
    },
  });
}

function loadRateLimitModule() {
  const modulePath = require.resolve('../worker/src/rateLimit.js');
  delete require.cache[modulePath];
  return require(modulePath) as {
    checkAndIncrement: (accountId: string, action: string) => Promise<unknown>;
  };
}

function createFakeResponse() {
  return {
    statusCode: 200,
    headersSent: false,
    payload: undefined as unknown,
    timeoutMs: 0,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      this.headersSent = true;
      return this;
    },
    setTimeout(ms: number) {
      this.timeoutMs = ms;
      return this;
    },
    setHeader() {
      return this;
    },
  };
}

describe('message session security routes', () => {
  beforeEach(() => {
    vi.resetModules();
    routeMocks.authenticateCaller.mockResolvedValue(null);
    routeMocks.forwardToBackend.mockResolvedValue(NextResponse.json({ ok: true }));
    routeMocks.fetchBackendResponse.mockResolvedValue(
      new Response(JSON.stringify({ conversations: [{ accountId: 'acct-1' }, { accountId: 'acct-2' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    routeMocks.authorizeAccountAccess.mockResolvedValue({
      actor: { authenticated: true, kind: 'user-session', role: 'admin', userId: 'admin-1' },
      accountId: 'acct-1',
      allowedAccountIds: new Set(['acct-1']),
    });
    routeMocks.authorizeCollectionAccess.mockResolvedValue({
      actor: { authenticated: true, kind: 'user-session', role: 'admin', userId: 'admin-1' },
      allowedAccountIds: new Set(['acct-1']),
    });
    routeMocks.authorizeConversationAccess.mockResolvedValue({
      actor: { authenticated: true, kind: 'user-session', role: 'admin', userId: 'admin-1' },
      accountId: 'acct-1',
      conversationId: 'thread-1',
      allowedAccountIds: new Set(['acct-1']),
    });
  });

  it('blocks unauthenticated send-new requests', async () => {
    routeMocks.authorizeAccountAccess.mockResolvedValueOnce({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const { POST } = await import('@/app/api/messages/send-new/route');
    const response = await POST(makeJsonRequest('http://localhost/api/messages/send-new', {
      accountId: 'acct-1',
      profileUrl: 'https://www.linkedin.com/in/test-user',
      text: 'hello',
    }));

    expect(response.status).toBe(401);
    expect(routeMocks.forwardToBackend).not.toHaveBeenCalled();
  });

  it('allows admin send-new access for any accountId', async () => {
    const { POST } = await import('@/app/api/messages/send-new/route');
    const response = await POST(makeJsonRequest('http://localhost/api/messages/send-new', {
      accountId: 'acct-1',
      profileUrl: 'https://www.linkedin.com/in/test-user',
      text: 'hello',
    }));

    expect(routeMocks.authorizeAccountAccess).toHaveBeenCalledWith(expect.any(NextRequest), 'acct-1');
    expect(routeMocks.forwardToBackend).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/messages/send-new',
      body: expect.objectContaining({ accountId: 'acct-1', text: 'hello' }),
    }));
    expect(response.status).toBe(200);
  });

  it('blocks a normal user from sending on another accountId', async () => {
    routeMocks.authorizeAccountAccess.mockResolvedValueOnce({
      response: NextResponse.json({ error: 'Forbidden: account access denied' }, { status: 403 }),
    });

    const { POST } = await import('@/app/api/messages/send-new/route');
    const response = await POST(makeJsonRequest('http://localhost/api/messages/send-new', {
      accountId: 'acct-2',
      profileUrl: 'https://www.linkedin.com/in/test-user',
      text: 'hello',
    }));

    expect(response.status).toBe(403);
    expect(routeMocks.forwardToBackend).not.toHaveBeenCalled();
  });

  it('rejects missing message text', async () => {
    const { POST } = await import('@/app/api/messages/send-new/route');
    const response = await POST(makeJsonRequest('http://localhost/api/messages/send-new', {
      accountId: 'acct-1',
      profileUrl: 'https://www.linkedin.com/in/test-user',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing required fields: accountId, text',
    });
  });

  it('rejects missing accountId', async () => {
    const { POST } = await import('@/app/api/messages/send-new/route');
    const response = await POST(makeJsonRequest('http://localhost/api/messages/send-new', {
      profileUrl: 'https://www.linkedin.com/in/test-user',
      text: 'hello',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing required fields: accountId, text',
    });
  });

  it('rejects missing send target', async () => {
    const { POST } = await import('@/app/api/messages/send-new/route');
    const response = await POST(makeJsonRequest('http://localhost/api/messages/send-new', {
      accountId: 'acct-1',
      text: 'hello',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Either profileUrl or chatId is required',
    });
  });

  it('rejects oversized outbound message text', async () => {
    const { POST } = await import('@/app/api/messages/send-new/route');
    const response = await POST(makeJsonRequest('http://localhost/api/messages/send-new', {
      accountId: 'acct-1',
      profileUrl: 'https://www.linkedin.com/in/test-user',
      text: 'a'.repeat(3001),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Message must be 3000 characters or less',
    });
  });

  it('blocks unauthenticated sync/messages requests', async () => {
    routeMocks.authorizeAccountAccess.mockResolvedValueOnce({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const { POST } = await import('@/app/api/sync/messages/route');
    const response = await POST(makeJsonRequest('http://localhost/api/sync/messages', {
      accountId: 'acct-1',
    }));

    expect(response.status).toBe(401);
    expect(routeMocks.forwardToBackend).not.toHaveBeenCalled();
  });

  it('allows a normal user to sync only an assigned account', async () => {
    routeMocks.authorizeAccountAccess.mockResolvedValueOnce({
      actor: { authenticated: true, kind: 'user-session', role: 'user', userId: 'user-1' },
      accountId: 'acct-1',
      allowedAccountIds: new Set(['acct-1']),
    });
    const { POST } = await import('@/app/api/sync/messages/route');
    const response = await POST(makeJsonRequest('http://localhost/api/sync/messages', {
      accountId: 'acct-1',
    }));

    expect(response.status).toBe(200);
    expect(routeMocks.forwardToBackend).toHaveBeenCalledWith(expect.objectContaining({
      path: '/sync/messages',
      body: { accountId: 'acct-1' },
    }));
  });

  it('blocks a normal user from syncing another accountId', async () => {
    routeMocks.authorizeAccountAccess.mockResolvedValueOnce({
      response: NextResponse.json({ error: 'Forbidden: account access denied' }, { status: 403 }),
    });

    const { POST } = await import('@/app/api/sync/messages/route');
    const response = await POST(makeJsonRequest('http://localhost/api/sync/messages', {
      accountId: 'acct-2',
    }));

    expect(response.status).toBe(403);
    expect(routeMocks.forwardToBackend).not.toHaveBeenCalled();
  });

  it('requires explicit accountId for non-admin bulk sync across multiple accounts', async () => {
    routeMocks.authorizeCollectionAccess.mockResolvedValueOnce({
      actor: { authenticated: true, kind: 'user-session', role: 'user', userId: 'user-1' },
      allowedAccountIds: new Set(['acct-1', 'acct-2']),
    });

    const { POST } = await import('@/app/api/sync/messages/route');
    const response = await POST(makeJsonRequest('http://localhost/api/sync/messages'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden: accountId is required for non-admin sync across multiple accounts',
    });
  });

  it('blocks unauthenticated export/messages requests', async () => {
    routeMocks.authorizeAccountAccess.mockResolvedValueOnce({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const { POST } = await import('@/app/api/export/messages/route');
    const response = await POST(makeJsonRequest('http://localhost/api/export/messages', {
      format: 'json',
      accountId: 'acct-1',
    }));

    expect(response.status).toBe(401);
    expect(routeMocks.forwardToBackend).not.toHaveBeenCalled();
  });

  it('blocks export/messages for an unassigned accountId', async () => {
    routeMocks.authorizeAccountAccess.mockResolvedValueOnce({
      response: NextResponse.json({ error: 'Forbidden: account access denied' }, { status: 403 }),
    });

    const { POST } = await import('@/app/api/export/messages/route');
    const response = await POST(makeJsonRequest('http://localhost/api/export/messages', {
      format: 'json',
      accountId: 'acct-2',
    }));

    expect(response.status).toBe(403);
  });

  it('allows export/messages for an assigned conversationId', async () => {
    routeMocks.authorizeConversationAccess.mockResolvedValueOnce({
      actor: { authenticated: true, kind: 'user-session', role: 'user', userId: 'user-1' },
      accountId: 'acct-1',
      conversationId: 'thread-1',
      allowedAccountIds: new Set(['acct-1']),
    });

    const { POST } = await import('@/app/api/export/messages/route');
    const response = await POST(makeJsonRequest('http://localhost/api/export/messages', {
      format: 'json',
      conversationId: 'thread-1',
    }));

    expect(response.status).toBe(200);
    expect(routeMocks.forwardToBackend).toHaveBeenCalledWith(expect.objectContaining({
      path: '/export/messages',
      body: {
        format: 'json',
        accountId: 'acct-1',
        conversationId: 'thread-1',
      },
    }));
  });

  it('blocks messages/thread for an unassigned accountId', async () => {
    routeMocks.authorizeAccountAccess.mockResolvedValueOnce({
      response: NextResponse.json({ error: 'Forbidden: account access denied' }, { status: 403 }),
    });

    const { GET } = await import('@/app/api/messages/thread/route');
    const response = await GET(makeGetRequest('http://localhost/api/messages/thread?accountId=acct-2&chatId=thread-2'));

    expect(response.status).toBe(403);
    expect(routeMocks.forwardToBackend).not.toHaveBeenCalled();
  });

  it('filters inbox/unified results to allowed accounts for a normal user', async () => {
    routeMocks.authorizeCollectionAccess.mockResolvedValueOnce({
      actor: { authenticated: true, kind: 'user-session', role: 'user', userId: 'user-1' },
      allowedAccountIds: new Set(['acct-1']),
    });

    const { GET } = await import('@/app/api/inbox/unified/route');
    const response = await GET(makeGetRequest('http://localhost/api/inbox/unified?limit=25'));

    expect(routeMocks.fetchBackendResponse).toHaveBeenCalledOnce();
    expect(routeMocks.filterAccountScopedPayload).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      conversations: [{ accountId: 'acct-1' }],
    });
  });

  it('blocks inbox/unified for unauthenticated users', async () => {
    routeMocks.authorizeCollectionAccess.mockResolvedValueOnce({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const { GET } = await import('@/app/api/inbox/unified/route');
    const response = await GET(makeGetRequest('http://localhost/api/inbox/unified?limit=25'));

    expect(response.status).toBe(401);
    expect(routeMocks.fetchBackendResponse).not.toHaveBeenCalled();
  });
});

describe('worker sync route validation', () => {
  it('rejects invalid accountId before starting sync work', async () => {
    type RegisteredSyncHandler = (
      req: {
        body?: { accountId?: string };
        log?: {
          child: () => unknown;
          info: ReturnType<typeof vi.fn>;
          error: ReturnType<typeof vi.fn>;
        };
      },
      res: ReturnType<typeof createFakeResponse>
    ) => Promise<unknown>;

    const { registerSyncRoutes } = require('../worker/src/routes/sync.js') as {
      registerSyncRoutes: (
        app: { post: (path: string, handler: RegisteredSyncHandler) => void },
        deps: Record<string, unknown>
      ) => void;
    };

    let handler: RegisteredSyncHandler | null = null;
    registerSyncRoutes(
      {
        post(path: string, routeHandler: RegisteredSyncHandler) {
          if (path === '/sync/messages') handler = routeHandler;
        },
      },
      {
        assertKnownAccountId: vi.fn(async () => {
          const error = new Error('Unknown accountId');
          (error as Error & { status?: number; code?: string }).status = 400;
          (error as Error & { status?: number; code?: string }).code = 'INVALID_ACCOUNT_ID';
          throw error;
        }),
        applyRetryAfterHeader: vi.fn(() => undefined),
        syncAccount: vi.fn(),
        syncAllAccounts: vi.fn(),
        invalidateUnifiedInboxCache: vi.fn(),
        markBulkSyncStarted: vi.fn(),
        recordSyncResult: vi.fn(),
        recordSessionExpired: vi.fn(),
        logger: {
          child() {
            return this;
          },
          info: vi.fn(),
          error: vi.fn(),
        },
      }
    );

    if (!handler) throw new Error('Expected /sync/messages route handler to be registered');
    const syncHandler = handler as RegisteredSyncHandler;

    const res = createFakeResponse();
    await syncHandler(
      {
        body: { accountId: 'bad-account' },
        log: {
          child() {
            return this;
          },
          info: vi.fn(),
          error: vi.fn(),
        },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({
      error: 'Unknown accountId',
      code: 'INVALID_ACCOUNT_ID',
    });
  });
});

describe('message session security helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.DISABLE_REDIS = '1';
    process.env.RATE_LIMIT_MESSAGES_SENT = '3';
    process.env.RATE_LIMIT_MESSAGES_SENT_HOURLY = '5';
    process.env.RATE_LIMIT_MESSAGES_SENT_MIN_GAP_SEC = '2';
    process.env.RATE_LIMIT_MESSAGES_SENT_BURST_LIMIT = '5';
    process.env.RATE_LIMIT_MESSAGES_SENT_BURST_WINDOW_SEC = '60';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('escapes dangerous message text instead of rendering executable HTML', async () => {
    const { MessageThread } = await import('@/components/inbox/MessageThread');
    const payload = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>';

    const html = renderToStaticMarkup(
      React.createElement(MessageThread, {
        conversation: {
          conversationId: 'chat-1',
          accountId: 'acct-1',
          participant: {
            name: 'Receiver',
            profileUrl: 'https://www.linkedin.com/in/receiver',
            avatarUrl: null,
          },
          lastMessage: {
            text: payload,
            sentAt: Date.now(),
            sentByMe: false,
          },
          unreadCount: 0,
          messages: [
            {
              id: 'msg-1',
              text: payload,
              sentAt: Date.now(),
              sentByMe: false,
              senderName: 'Receiver',
            },
          ],
        },
        accountLabelById: { 'acct-1': 'Sender Account' },
        onMessageSent: vi.fn(),
        onSyncAfterSend: vi.fn(async () => undefined),
      })
    );

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('enforces cooldown between consecutive send attempts', async () => {
    vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
    const rateLimit = loadRateLimitModule();

    await rateLimit.checkAndIncrement('acct-cooldown-security', 'messagesSent');

    await expect(
      rateLimit.checkAndIncrement('acct-cooldown-security', 'messagesSent')
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
    });
  });
});
