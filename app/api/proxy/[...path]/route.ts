import { NextRequest, NextResponse } from 'next/server';

type Role = 'user' | 'admin';
type AuthContext = { role: Role };

type RouteRule = {
  pattern: RegExp;
  methods: ReadonlySet<string>;
  roles: ReadonlySet<Role>;
  injectApiKey: boolean;
};

const BACKEND          = process.env.API_URL              ?? 'http://localhost:3001';
const SECRET           = process.env.API_SECRET           ?? '';
const AUTH_COOKIE_NAME = process.env.PROXY_AUTH_COOKIE_NAME ?? 'proxy_session';

/**
 * TOKEN_ROLE_MAP — loaded from PROXY_AUTH_TOKENS env var at module initialisation.
 * Shape: { "<token>": "user" | "admin", ... }
 * Generate tokens: openssl rand -hex 32
 */
const TOKEN_ROLE_MAP: Readonly<Record<string, Role>> = (() => {
  const raw = process.env.PROXY_AUTH_TOKENS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const valid: Record<string, Role> = {};
    for (const [token, role] of Object.entries(parsed)) {
      if ((role === 'admin' || role === 'user') && token) {
        valid[token] = role;
      }
    }
    return valid;
  } catch {
    console.error('[proxy] PROXY_AUTH_TOKENS is not valid JSON — no tokens loaded.');
    return {};
  }
})();

/**
 * ALLOWLIST — the only routes this proxy will forward.
 *
 * Security notes:
 * - stats/:accountId pattern uses [a-zA-Z0-9_-]+ intentionally.
 *   This prevents path injection via the accountId segment.
 * - messages/send is admin-only because it is a write action.
 */
const ALLOWLIST: readonly RouteRule[] = [
  {
    pattern:      /^accounts$/,
    methods:      new Set(['GET']),
    roles:        new Set(['user', 'admin']),
    injectApiKey: true,
  },
  {
    pattern:      /^inbox\/unified$/,
    methods:      new Set(['GET']),
    roles:        new Set(['user', 'admin']),
    injectApiKey: true,
  },
  {
    pattern:      /^connections\/unified$/,
    methods:      new Set(['GET']),
    roles:        new Set(['user', 'admin']),
    injectApiKey: true,
  },
  {
    pattern:      /^messages\/thread$/,
    methods:      new Set(['GET']),
    roles:        new Set(['user', 'admin']),
    injectApiKey: true,
  },
  {
    pattern:      /^messages\/send$/,
    methods:      new Set(['POST']),
    roles:        new Set(['admin']),   // write action — admin only
    injectApiKey: true,
  },
  {
    pattern:      /^stats\/all\/summary$/,
    methods:      new Set(['GET']),
    roles:        new Set(['user', 'admin']),
    injectApiKey: true,
  },
  {
    pattern:      /^stats\/[a-zA-Z0-9._:-]+\/activity$/,
    methods:      new Set(['GET']),
    roles:        new Set(['user', 'admin']),
    injectApiKey: true,
  },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

function jsonError(status: number, message: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      Pragma: 'no-cache',
      Vary: 'Cookie, Authorization, Origin',
    },
  });
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function authenticate(req: NextRequest): AuthContext | null {
  const token =
    getBearerToken(req) ??
    req.cookies.get(AUTH_COOKIE_NAME)?.value ??
    null;
  if (!token) return null;
  const role = TOKEN_ROLE_MAP[token];
  if (!role) return null;
  return { role };
}

function resolveRule(pathStr: string, method: string): RouteRule | null {
  for (const rule of ALLOWLIST) {
    if (rule.pattern.test(pathStr) && rule.methods.has(method)) {
      return rule;
    }
  }
  return null;
}

/**
 * Build and validate the final backend URL.
 * Returns null if the constructed URL origin does not match BACKEND — SSRF guard.
 * Validation happens BEFORE fetch(), not in a try/catch after.
 */
function buildBackendUrl(pathStr: string, search: string): URL | null {
  try {
    const base   = new URL(BACKEND);
    const target = new URL(
      `${base.origin}${base.pathname.replace(/\/$/, '')}/${pathStr}${search}`
    );
    if (target.origin !== base.origin) return null;
    return target;
  } catch {
    return null;
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  // 1. Authenticate — Bearer token or session cookie
  const auth = authenticate(req);
  if (!auth) return jsonError(401, 'Unauthorized');

  // Enforce CSRF protection for POST/write methods
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    const csrfToken = req.headers.get('x-csrf-token');
    
    // If not using a Bearer token (meaning we rely on proxy_session cookie)
    if (getBearerToken(req) === null) {
      // Validate Origin matches Host if present
      if (origin && host) {
        try {
          const originUrl = new URL(origin);
          if (originUrl.host !== host) {
            return jsonError(403, 'CSRF Origin Mismatch');
          }
        } catch {
          return jsonError(403, 'CSRF Origin Mismatch');
        }
      } else if (!csrfToken) {
        // Fallback: strictly require custom CSRF header when relying on cookies and missing origin
        return jsonError(403, 'Missing CSRF Token or Valid Origin');
      }
    }
  }

  // 2. Normalise path — reject traversal sequences
  const { path } = await params;
  const pathStr = path.join('/');
  if (pathStr.includes('..') || pathStr.toLowerCase().includes('%2e')) {
    return jsonError(400, 'Invalid path');
  }

  // 3. Allowlist check — method + pattern must match
  const rule = resolveRule(pathStr, req.method);
  if (!rule) return jsonError(403, 'Forbidden route or method');

  // 4. Role check
  if (!rule.roles.has(auth.role)) return jsonError(403, 'Insufficient permissions');

  // 5. Build and validate backend URL (SSRF-safe, validated before fetch)
  const backendUrl = buildBackendUrl(pathStr, req.nextUrl.search);
  if (!backendUrl) return jsonError(400, 'Invalid backend URL construction');

  // 6. Forward to worker API
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (rule.injectApiKey && SECRET) {
    headers['X-Api-Key'] = SECRET;
  }

  const body =
    req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.text()
      : undefined;

  try {
    const res  = await fetch(backendUrl.toString(), {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
        Pragma: 'no-cache',
        Vary: 'Cookie, Authorization, Origin',
      },
    });
  } catch {
    return jsonError(502, 'Backend unreachable');
  }
}

// Only export methods present in the allowlist.
// Exporting DELETE/PATCH/PUT widens the attack surface without benefit.
export const GET  = handler;
export const POST = handler;
