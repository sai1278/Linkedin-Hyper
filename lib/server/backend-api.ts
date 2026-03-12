import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.API_URL ?? 'http://localhost:3001';
const BACKEND_SECRET = process.env.API_SECRET ?? '';
const CALLER_TOKEN = process.env.API_ROUTE_AUTH_TOKEN;

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export function authenticateCaller(req: NextRequest): NextResponse | null {
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin) {
    return jsonError(401, 'Unauthorized caller origin');
  }

  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
    return jsonError(401, 'Unauthorized caller context');
  }

  if (CALLER_TOKEN) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${CALLER_TOKEN}`) {
      return jsonError(401, 'Missing or invalid API route token');
    }
  }

  return null;
}

function resolveBackendUrl(path: string, query?: URLSearchParams): URL {
  const backend = new URL(BACKEND);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(normalizedPath, backend);

  if (query) {
    url.search = query.toString();
  }

  if (url.origin !== backend.origin) {
    throw new Error('Backend origin mismatch');
  }

  return url;
}

export async function forwardToBackend({
  method,
  path,
  query,
  body,
}: {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: URLSearchParams;
  body?: unknown;
}): Promise<NextResponse> {
  const url = resolveBackendUrl(path, query);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': BACKEND_SECRET,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
      },
    });
  } catch {
    return jsonError(502, 'Backend unreachable');
  }
}

export function requireString(value: string | null, name: string): string {
  if (!value || !value.trim()) {
    throw new Error(`Invalid ${name}`);
  }

  return value;
}

export function requireInteger(
  value: string | null,
  name: string,
  { min, max, fallback }: { min?: number; max?: number; fallback?: number } = {}
): number {
  if ((value === null || value === '') && fallback !== undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid ${name}`);
  }

  if (min !== undefined && parsed < min) {
    throw new Error(`Invalid ${name}`);
  }

  if (max !== undefined && parsed > max) {
    throw new Error(`Invalid ${name}`);
  }

  return parsed;
}

export function badRequest(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : 'Invalid request';
  return jsonError(400, message);
}
