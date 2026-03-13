import { NextRequest, NextResponse } from 'next/server';

const API_URL    = process.env.API_URL    ?? 'http://localhost:3001';
const API_SECRET = process.env.API_SECRET ?? '';

/** 
 * Authenticate incoming requests to the BFF.
 * Enforces Same-Origin and optional API_ROUTE_AUTH_TOKEN.
 */
export function authenticateCaller(req: NextRequest): NextResponse | null {
  // 1. Origin check — skip if no origin header (SSR/server-to-server calls)
  //    When present, allow same-origin OR trusted Ngrok/proxy origins.
  const origin = req.headers.get('origin');
  if (origin) {
    const requestOrigin = req.nextUrl.origin;
    const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    const isTrusted =
      origin === requestOrigin || trustedOrigins.includes(origin);

    if (!isTrusted) {
      return NextResponse.json({ error: 'Forbidden: Invalid Origin' }, { status: 403 });
    }
  }

  // 2. Sec-Fetch-Site — only block explicitly cross-site requests
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
    return NextResponse.json({ error: 'Forbidden: Invalid Sec-Fetch-Site' }, { status: 403 });
  }

  // 3. API_ROUTE_AUTH_TOKEN — if set, enforce Bearer token
  const expectedToken = process.env.API_ROUTE_AUTH_TOKEN;
  if (expectedToken) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return null;
}

/**
 * Forward a request to the worker Express API.
 * Adds X-Api-Key header automatically.
 * Includes a 30-second AbortSignal timeout.
 */
export async function forwardToBackend(opts: ForwardOptions): Promise<NextResponse> {
  const { method, path, query, body } = opts;
  const qs    = query ? `?${query.toString()}` : '';
  const url   = `${API_URL}${path}${qs}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': API_SECRET,
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
    return NextResponse.json(
      { error: isTimeout ? 'Backend request timed out' : 'Backend unreachable' },
      { status: 502 }
    );
  }
}

/** Validate and return a required string param; throws on failure. */
export function requireString(value: string | null, name: string): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required field: ${name}`);
  }
  return value.trim();
}

interface IntegerOptions {
  min?: number;
  max?: number;
  fallback?: number;
}

/** Parse an optional integer param with min/max bounds and an optional fallback. */
export function requireInteger(
  value: string | null,
  name: string,
  opts: IntegerOptions = {}
): number {
  const { min, max, fallback } = opts;

  if (value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required integer: ${name}`);
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid integer for ${name}: "${value}"`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`${name} must be >= ${min}`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${name} must be <= ${max}`);
  }
  return parsed;
}

/** Return a 400 JSON response from a caught Error or unknown. */
export function badRequest(error: unknown): NextResponse {
  const message =
    error instanceof Error ? error.message : 'Bad request';
  return NextResponse.json({ error: message }, { status: 400 });
}
