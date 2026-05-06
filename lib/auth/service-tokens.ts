import { createHash, timingSafeEqual } from 'node:crypto';
import { isStaticServiceTokenAllowed } from './runtime';

export type ServiceTokenRole = 'user' | 'admin';
export type ServiceTokenAudience = 'proxy' | 'backend-api';
export type ServiceTokenKind = 'hashed' | 'legacy-static';

export interface ServiceTokenMetadata {
  id: string;
  role: ServiceTokenRole;
  expiresAt: string | null;
  createdAt: string | null;
  rotatedAt: string | null;
  audiences: ServiceTokenAudience[];
  kind: ServiceTokenKind;
}

export interface ServiceTokenAuthResult {
  ok: boolean;
  token?: ServiceTokenMetadata;
  reason?: 'missing' | 'invalid' | 'expired';
}

type ParsedServiceTokenRecord = {
  id: string;
  role: ServiceTokenRole;
  tokenHash: string;
  expiresAt: string;
  createdAt: string | null;
  rotatedAt: string | null;
  audiences: ServiceTokenAudience[];
};

const DEFAULT_AUDIENCES: ServiceTokenAudience[] = ['proxy', 'backend-api'];

function isRole(value: unknown): value is ServiceTokenRole {
  return value === 'user' || value === 'admin';
}

function isAudience(value: unknown): value is ServiceTokenAudience {
  return value === 'proxy' || value === 'backend-api';
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqualHex(actualHex: string, expectedHex: string): boolean {
  const actual = Buffer.from(actualHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length === 0 || expected.length === 0 || actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  try {
    const iso = new Date(String(value)).toISOString();
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  } catch {
    return null;
  }
}

function parseAudiences(value: unknown): ServiceTokenAudience[] {
  if (!Array.isArray(value)) return DEFAULT_AUDIENCES;
  const filtered = value.filter(isAudience);
  return filtered.length > 0 ? filtered : DEFAULT_AUDIENCES;
}

function parseConfiguredServiceTokens(): ParsedServiceTokenRecord[] {
  const raw = process.env.SERVICE_AUTH_TOKENS?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      const id = String(record.id || `service-token-${index + 1}`).trim();
      const role = record.role;
      const tokenHash = String(record.tokenHash || record.hash || '').trim().toLowerCase();
      const expiresAt = normalizeDate(record.expiresAt);
      const createdAt = normalizeDate(record.createdAt);
      const rotatedAt = normalizeDate(record.rotatedAt);
      const audiences = parseAudiences(record.audiences);

      if (!id || !isRole(role) || !/^[a-f0-9]{64}$/i.test(tokenHash) || !expiresAt) {
        return [];
      }

      return [{
        id,
        role,
        tokenHash,
        expiresAt,
        createdAt,
        rotatedAt,
        audiences,
      }];
    });
  } catch {
    return [];
  }
}

function parseLegacyProxyTokens(): Array<{ token: string; role: ServiceTokenRole }> {
  if (!isStaticServiceTokenAllowed()) return [];

  const raw = process.env.PROXY_AUTH_TOKENS?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).flatMap(([token, role]) => (
      token && isRole(role) ? [{ token, role }] : []
    ));
  } catch {
    return [];
  }
}

function parseLegacyRouteToken(): Array<{ token: string; role: ServiceTokenRole }> {
  if (!isStaticServiceTokenAllowed()) return [];

  const token = process.env.API_ROUTE_AUTH_TOKEN?.trim();
  if (!token) return [];

  return [{ token, role: 'admin' }];
}

function isExpired(expiresAt: string): boolean {
  return Date.parse(expiresAt) <= Date.now();
}

export function authenticateServiceToken(
  rawToken: string | null | undefined,
  audience: ServiceTokenAudience
): ServiceTokenAuthResult {
  const token = String(rawToken || '').trim();
  if (!token) {
    return { ok: false, reason: 'missing' };
  }

  const hashedToken = sha256Hex(token);
  for (const configuredToken of parseConfiguredServiceTokens()) {
    if (!configuredToken.audiences.includes(audience)) continue;
    if (!safeEqualHex(hashedToken, configuredToken.tokenHash)) continue;
    if (isExpired(configuredToken.expiresAt)) {
      return { ok: false, reason: 'expired' };
    }

    return {
      ok: true,
      token: {
        id: configuredToken.id,
        role: configuredToken.role,
        expiresAt: configuredToken.expiresAt,
        createdAt: configuredToken.createdAt,
        rotatedAt: configuredToken.rotatedAt,
        audiences: configuredToken.audiences,
        kind: 'hashed',
      },
    };
  }

  const legacyTokens = audience === 'proxy'
    ? parseLegacyProxyTokens()
    : parseLegacyRouteToken();

  for (const legacyToken of legacyTokens) {
    if (legacyToken.token !== token) continue;
    return {
      ok: true,
      token: {
        id: `legacy-${audience}`,
        role: legacyToken.role,
        expiresAt: null,
        createdAt: null,
        rotatedAt: null,
        audiences: [audience],
        kind: 'legacy-static',
      },
    };
  }

  return { ok: false, reason: 'invalid' };
}
