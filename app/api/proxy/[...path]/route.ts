import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.API_URL ?? 'http://localhost:3001';
const SECRET = process.env.API_SECRET ?? '';

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const pathStr = path.join('/');
  const url = `${BACKEND}/${pathStr}${req.nextUrl.search}`;

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
