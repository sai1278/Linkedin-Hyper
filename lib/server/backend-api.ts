import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { isStaticServiceTokenAllowed } from '@/lib/auth/runtime';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const API_SECRET = process.env.API_SECRET ?? '';
const BACKEND_NETWORK_RETRY_COUNT = 1;
const BACKEND_NETWORK_RETRY_DELAY_MS = 250;
let serviceTokenWarningShown = false;
let apiSecretOperatorWarningShown = false;

interface AuthenticateCallerOptions {
  allowApiSecret?: boolean;
}

export interface AuthenticatedActor {
  authenticated: true;
  kind: 'api-secret' | 'service-token' | 'user-session';
  role: 'admin' | 'user';
  userId?: string;
  email?: string;
  name?: string;
}

function applyPrivateNoStore(headers: Headers): void {
  headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Vary', 'Cookie, Authorization, Origin');
}

function buildAllowedOrigins(req: NextRequest): Set<string> {
  const origins = new Set<string>();

  // Next.js computed origin (works in most local deployments).
  origins.add(req.nextUrl.origin);

  // Forwarded headers are required when app is accessed via public IP/domain/reverse proxy.
  const host =
    req.headers.get('x-forwarded-host') ??
    req.headers.get('host') ??
    '';
  const protoHeader =
    req.headers.get('x-forwarded-proto') ??
    req.nextUrl.protocol.replace(':', '');
  const proto = protoHeader || 'http';

  if (host) {
    origins.add(`${proto}://${host}`);
  }

  return origins;
}

function extractOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isTrustedOrigin(req: NextRequest, candidate: string): boolean {
  const allowedOrigins = buildAllowedOrigins(req);
  const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return allowedOrigins.has(candidate) || trustedOrigins.includes(candidate);
}

function isMutationMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export function enforceMutationProtection(req: NextRequest): NextResponse | null {
  if (!isMutationMethod(req.method)) {
    return null;
  }

  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
    return NextResponse.json({ error: 'Forbidden: Invalid Sec-Fetch-Site' }, { status: 403 });
  }

  const origin = extractOrigin(req.headers.get('origin'));
  if (origin) {
    if (!isTrustedOrigin(req, origin)) {
      return NextResponse.json({ error: 'Forbidden: Invalid Origin' }, { status: 403 });
    }
    return null;
  }

  const refererOrigin = extractOrigin(req.headers.get('referer'));
  if (refererOrigin) {
    if (!isTrustedOrigin(req, refererOrigin)) {
      return NextResponse.json({ error: 'Forbidden: Invalid Referer' }, { status: 403 });
    }
    return null;
  }

  return NextResponse.json({ error: 'Forbidden: Missing same-origin proof' }, { status: 403 });
}

function secretsMatch(actual: string | null, expected: string): boolean {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

/**
 * Authenticate incoming requests to the BFF.
 * Requires either a valid dashboard session cookie or API_ROUTE_AUTH_TOKEN bearer token.
 * Enforces same-origin checks for cookie-authenticated mutation requests.
 */
export async function authenticateCaller(
  req: NextRequest,
  options: AuthenticateCallerOptions = {}
): Promise<NextResponse | null> {
  const { response } = await getAuthenticatedActor(req, options);
  return response;
}

export async function getAuthenticatedActor(
  req: NextRequest,
  options: AuthenticateCallerOptions = {}
): Promise<{ actor: AuthenticatedActor | null; response: NextResponse | null }> {
  const { allowApiSecret = false } = options;
  const apiSecretHeader = req.headers.get('x-api-key');
  if (allowApiSecret && secretsMatch(apiSecretHeader, API_SECRET)) {
    if (!apiSecretOperatorWarningShown) {
      apiSecretOperatorWarningShown = true;
      console.warn('[backend-api] API_SECRET operator access used through BFF allowlist. This path is limited to cookie/session recovery endpoints.');
    }
    return {
      actor: {
        authenticated: true,
        kind: 'api-secret',
        role: 'admin',
      },
      response: null,
    };
  }

  const expectedToken = process.env.API_ROUTE_AUTH_TOKEN?.trim();
  const authHeader = req.headers.get('authorization');
  const bearerMatches = Boolean(expectedToken && authHeader === `Bearer ${expectedToken}`);
  const hasValidBearer = bearerMatches && isStaticServiceTokenAllowed();

  if (hasValidBearer) {
    if (!serviceTokenWarningShown) {
      serviceTokenWarningShown = true;
      console.warn('[backend-api] Static service bearer token used for BFF access. Prefer DB-backed session auth for interactive operators.');
    }
    return {
      actor: {
        authenticated: true,
        kind: 'service-token',
        role: 'admin',
      },
      response: null,
    };
  }

  if (bearerMatches && !hasValidBearer) {
    return {
      actor: null,
      response: NextResponse.json(
        { error: 'Static service bearer tokens are disabled in production' },
        { status: 403 }
      ),
    };
  }

  const session = await getSession(req);
  const hasDbBackedSession = Boolean(
    session?.authenticated &&
    session.userId &&
    (session.role === 'admin' || session.role === 'user')
  );

  if (!hasDbBackedSession) {
    return {
      actor: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const origin = extractOrigin(req.headers.get('origin'));
  if (origin && !isTrustedOrigin(req, origin)) {
    return {
      actor: null,
      response: NextResponse.json({ error: 'Forbidden: Invalid Origin' }, { status: 403 }),
    };
  }

  if (isMutationMethod(req.method)) {
    const csrfError = enforceMutationProtection(req);
    if (csrfError) {
      return {
        actor: null,
        response: csrfError,
      };
    }
  }

  const authenticatedSession = session as NonNullable<typeof session>;

  return {
    actor: {
      authenticated: true,
      kind: 'user-session',
      role: authenticatedSession.role as 'admin' | 'user',
      userId: authenticatedSession.userId,
      email: authenticatedSession.email,
      name: authenticatedSession.name,
    },
    response: null,
  };
}

interface ForwardOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: URLSearchParams;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Forward a request to the worker Express API.
 * Adds X-Api-Key header automatically.
 * Includes a default 120-second AbortSignal timeout (override via timeoutMs).
 */
export async function forwardToBackend(opts: ForwardOptions): Promise<NextResponse> {
  try {
    const res = await fetchBackendResponse(opts);

    const data = await res.text();
    const isNoContentStatus = res.status === 204 || res.status === 205 || res.status === 304;

    const headers = new Headers();
    // Dashboard state is user-specific and should never be cached publicly.
    applyPrivateNoStore(headers);

    const upstreamType = res.headers.get('content-type');
    if (!isNoContentStatus) {
      headers.set('Content-Type', upstreamType ?? 'application/json');
      return new NextResponse(data, { status: res.status, headers });
    }

    // 204/205/304 must not include a response body.
    return new NextResponse(null, { status: res.status, headers });
  } catch (err) {
    const isTimeout = isTimeoutError(err);
    return NextResponse.json(
      { error: isTimeout ? 'Backend request timed out' : 'Backend unreachable' },
      { status: 502 }
    );
  }
}

export async function fetchBackendResponse(opts: ForwardOptions): Promise<Response> {
  const { method, path, query, body, timeoutMs } = opts;
  const qs = query ? `?${query.toString()}` : '';
  const url = `${API_URL}${path}${qs}`;
  const parsedTimeoutMs = typeof timeoutMs === 'number' ? timeoutMs : NaN;
  const effectiveTimeoutMs = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
    ? parsedTimeoutMs
    : 120_000;

  const requestInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_SECRET,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(effectiveTimeoutMs),
  };

  return fetchBackendWithRetry(url, requestInit);
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'TimeoutError';
}

async function fetchBackendWithRetry(
  url: string,
  init: RequestInit,
  retriesLeft: number = BACKEND_NETWORK_RETRY_COUNT
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (isTimeoutError(err) || retriesLeft <= 0) {
      throw err;
    }

    await new Promise((resolve) => setTimeout(resolve, BACKEND_NETWORK_RETRY_DELAY_MS));
    return fetchBackendWithRetry(url, init, retriesLeft - 1);
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
  const message = error instanceof Error ? error.message : 'Bad request';
  const res = NextResponse.json({ error: message }, { status: 400 });
  res.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Vary', 'Cookie, Authorization, Origin');
  return res;
}
