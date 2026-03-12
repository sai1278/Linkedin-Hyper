import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.API_URL ?? 'http://localhost:3001';
const SECRET = process.env.API_SECRET ?? '';

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const pathStr = path.join('/');

  // Prevent directory traversal
  if (pathStr.includes('..')) {
    return new NextResponse(JSON.stringify({ error: 'Invalid path' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = `${BACKEND}/${pathStr}${req.nextUrl.search}`;

  // Ensure the constructed URL strictly originates from the configured BACKEND origin
  try {
    const parsedUrl = new URL(url);
    const backendUrl = new URL(BACKEND);
    if (parsedUrl.origin !== backendUrl.origin) {
      throw new Error('Origin mismatch');
    }
  } catch {
    return new NextResponse(JSON.stringify({ error: 'Invalid backend URL construction' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Key': SECRET,
  };

  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined;

  try {
    const res = await fetch(url, { method: req.method, headers, body });
    const data = await res.text();

    return new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new NextResponse(JSON.stringify({ error: 'Backend unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const PATCH = handler;
export const PUT = handler;
