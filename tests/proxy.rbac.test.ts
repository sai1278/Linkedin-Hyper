import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeProxyRequest(pathname: string, token: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost/api/proxy/${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      origin: 'http://localhost',
      host: 'localhost',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('proxy RBAC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_URL', 'http://worker:3001');
    vi.stubEnv('API_SECRET', 'test-api-secret');
    vi.stubEnv('ALLOW_STATIC_SERVICE_TOKENS', 'true');
    vi.stubEnv('PROXY_AUTH_TOKENS', JSON.stringify({
      'user-token': 'user',
      'admin-token': 'admin',
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
  });

  it('allows user tokens on read routes', async () => {
    const { GET } = await import('@/app/api/proxy/[...path]/route');
    const response = await GET(
      makeProxyRequest('connections/unified', 'user-token'),
      { params: Promise.resolve({ path: ['connections', 'unified'] }) }
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('blocks user tokens on admin-only send routes', async () => {
    const { POST } = await import('@/app/api/proxy/[...path]/route');
    const response = await POST(
      makeProxyRequest('messages/send-new', 'user-token', 'POST', {
        accountId: 'acct-1',
        profileUrl: 'https://linkedin.com/in/test',
        text: 'hello',
      }),
      { params: Promise.resolve({ path: ['messages', 'send-new'] }) }
    );

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: 'Insufficient permissions' });
  });

  it('allows admin tokens on admin-only send routes', async () => {
    const { POST } = await import('@/app/api/proxy/[...path]/route');
    const response = await POST(
      makeProxyRequest('messages/send-new', 'admin-token', 'POST', {
        accountId: 'acct-1',
        profileUrl: 'https://linkedin.com/in/test',
        text: 'hello',
      }),
      { params: Promise.resolve({ path: ['messages', 'send-new'] }) }
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
