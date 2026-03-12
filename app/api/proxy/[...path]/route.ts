import { NextRequest, NextResponse } from 'next/server';
import { authenticateCaller, forwardToBackend } from '@/lib/server/backend-api';

const ALLOWLIST: Record<string, ReadonlySet<string>> = {
  GET: new Set([
    '/accounts',
    '/inbox/unified',
    '/messages/thread',
    '/stats/all/summary',
  ]),
  POST: new Set(['/messages/send']),
};

function buildNormalizedPath(parts: string[]): string {
  const joined = `/${parts.join('/')}`;
  if (joined.includes('..')) {
    throw new Error('Invalid path');
  }

  return joined;
}

/**
 * @deprecated Prefer per-feature handlers under app/api/*.
 */
async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const authError = authenticateCaller(req);
  if (authError) return authError;

  const { path } = await params;

  let normalizedPath = '';
  try {
    normalizedPath = buildNormalizedPath(path);
  } catch {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const allowedPaths = ALLOWLIST[req.method];
  if (!allowedPaths || !allowedPaths.has(normalizedPath)) {
    return NextResponse.json(
      { error: 'Proxy endpoint is deprecated for this route or method' },
      { status: 410 }
    );
  }

  return forwardToBackend({
    method: req.method as 'GET' | 'POST',
    path: normalizedPath,
    query: req.nextUrl.searchParams,
    body: req.method === 'POST' ? await req.json() : undefined,
  });
}

export const GET = handler;
export const POST = handler;
