import { NextRequest, NextResponse } from 'next/server';

type Role = 'user' | 'admin';

type AuthContext = {
  role: Role;
};

type RouteRule = {
  pattern: RegExp;
  methods: ReadonlySet<string>;
  roles: ReadonlySet<Role>;
  injectApiKey: boolean;
};

const BACKEND = process.env.API_URL ?? 'http://localhost:3001';
const SECRET = process.env.API_SECRET ?? '';
const AUTH_COOKIE_NAME = process.env.PROXY_AUTH_COOKIE_NAME ?? 'proxy_session';

const TOKEN_ROLE_MAP: Record<string, Role> = (() => {
  const raw = process.env.PROXY_AUTH_TOKENS;
  if (!raw) {
    return {};
  }

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
    return {};
  }
})();

const ALLOWLIST: readonly RouteRule[] = [
  {
    pattern: /^accounts$/,
    methods: new Set(['GET']),
    roles: new Set(['user', 'admin']),
    injectApiKey: true,
  },
  {
    pattern: /^inbox\/unified$/,
    methods: new Set(['GET']),
    roles: new Set(['user', 'admin']),
    injectApiKey: true,
  },
  {
    pattern: /^messages\/thread$/,
    methods: new Set(['GET']),
    roles: new Set(['user', 'admin']),
    injectApiKey: true,
  },
  {
    pattern: /^messages\/send$/,
    methods: new Set(['POST']),
    roles: new Set(['admin']),
    injectApiKey: true,
  },
  {
    pattern: /^stats\/all\/summary$/,
    methods: new Set(['GET']),
    roles: new Set(['user', 'admin']),
    injectApiKey: true,
  },
  {
    pattern: /^stats\/[^/]+\/activity$/,
    methods: new Set(['GET']),
    roles: new Set(['user', 'admin']),
    injectApiKey: true,
  },
] as const;

function jsonError(status: number, message: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function authenticate(req: NextRequest): AuthContext | null {
  const bearer = getBearerToken(req);
  const cookieToken = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const token = bearer ?? cookieToken;

  if (!token) {
    return null;
  }

  const role = TOKEN_ROLE_MAP[token];
  if (!role) {
    return null;
  }

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

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const auth = authenticate(req);
  if (!auth) {
    return jsonError(401, 'Unauthorized');
  }

  const { path } = await params;
  const pathStr = path.join('/');

  if (pathStr.includes('..')) {
    return jsonError(400, 'Invalid path');
  }

  const rule = resolveRule(pathStr, req.method);
  if (!rule) {
    return jsonError(403, 'Forbidden route or method');
  }

  if (!rule.roles.has(auth.role)) {
    return jsonError(403, 'Insufficient permissions');
  }

  const url = `${BACKEND}/${pathStr}${req.nextUrl.search}`;

  try {
    const parsedUrl = new URL(url);
    const backendUrl = new URL(BACKEND);
    if (parsedUrl.origin !== backendUrl.origin) {
      throw new Error('Origin mismatch');
    }
  } catch {
    return jsonError(400, 'Invalid backend URL construction');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (rule.injectApiKey && SECRET) {
    headers['X-Api-Key'] = SECRET;
  }

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
    return jsonError(502, 'Backend unreachable');
  }
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const PATCH = handler;
export const PUT = handler;
