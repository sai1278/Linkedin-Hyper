import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateCaller: vi.fn(),
  forwardToBackend: vi.fn(),
  authorizeAccountAccess: vi.fn(),
}));

vi.mock('@/lib/server/backend-api', () => ({
  authenticateCaller: mocks.authenticateCaller,
  forwardToBackend: mocks.forwardToBackend,
  badRequest: (error: unknown) => NextResponse.json(
    { error: error instanceof Error ? error.message : 'Bad request' },
    { status: 400 }
  ),
}));

vi.mock('@/lib/auth/account-access', () => ({
  authorizeAccountAccess: mocks.authorizeAccountAccess,
}));

describe('send-message route compatibility', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.authenticateCaller.mockResolvedValue(null);
    mocks.forwardToBackend.mockResolvedValue(
      NextResponse.json({ ok: true, proxied: true })
    );
    mocks.authorizeAccountAccess.mockResolvedValue({
      actor: { authenticated: true, kind: 'user-session', role: 'admin', userId: 'admin-1' },
      accountId: 'acct-1',
      allowedAccountIds: new Set(['acct-1']),
    });
  });

  it('keeps the old send route deprecated with HTTP 410', async () => {
    const { POST } = await import('@/app/api/messages/send/route');
    const response = await POST(new NextRequest('http://localhost/api/messages/send', {
      method: 'POST',
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: 'SEND_ROUTE_DEPRECATED',
    });
  });

  it('forwards the active send-new route to the backend', async () => {
    const { POST } = await import('@/app/api/messages/send-new/route');
    const response = await POST(new NextRequest('http://localhost/api/messages/send-new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: 'acct-1',
        profileUrl: 'https://linkedin.com/in/test-user',
        text: 'Hello from test',
      }),
    }));

    expect(mocks.forwardToBackend).toHaveBeenCalledWith({
      method: 'POST',
      path: '/messages/send-new',
      body: {
        accountId: 'acct-1',
        text: 'Hello from test',
        profileUrl: 'https://linkedin.com/in/test-user',
      },
      timeoutMs: 240_000,
    });
    expect(response.status).toBe(200);
  });
});
