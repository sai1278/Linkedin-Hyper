import { serverLogger } from '@/lib/server/logger';

const ACCOUNT_ACCESS_WARNING =
  'Account access is enabled but no admin emails or user account mapping configured.';
const ACCOUNT_ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;

let missingConfigWarningLogged = false;

function normalizePrincipalKey(value: string) {
  return String(value || '').trim().toLowerCase();
}

export function getConfiguredAdminEmails(): Set<string> {
  return new Set(
    String(process.env.INITIAL_ADMIN_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function getConfiguredAccountAccessMap(): Map<string, Set<string>> {
  const raw = process.env.USER_ACCOUNT_ACCESS ?? process.env.ACCOUNT_ACCESS_MAP ?? '';
  if (!raw.trim()) return new Map();

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mapping = new Map<string, Set<string>>();

    for (const [principal, allowedAccounts] of Object.entries(parsed || {})) {
      const normalizedPrincipal = normalizePrincipalKey(principal);
      if (!normalizedPrincipal) continue;

      const values = Array.isArray(allowedAccounts)
        ? allowedAccounts
        : typeof allowedAccounts === 'string'
          ? allowedAccounts.split(',')
          : [];

      const normalizedAccounts = new Set(
        values
          .map((value) => String(value || '').trim())
          .filter((value) => ACCOUNT_ID_RE.test(value))
      );

      if (normalizedAccounts.size > 0) {
        mapping.set(normalizedPrincipal, normalizedAccounts);
      }
    }

    return mapping;
  } catch {
    return new Map();
  }
}

export function getAccountAccessStartupCheck() {
  const adminEmails = getConfiguredAdminEmails();
  const accessMapping = getConfiguredAccountAccessMap();
  const configured = adminEmails.size > 0 || accessMapping.size > 0;

  return {
    id: 'account-access-config',
    label: 'Account access configuration',
    status: configured ? 'pass' : 'warn',
    detail: configured
      ? `Configured admin emails: ${adminEmails.size}; user account mappings: ${accessMapping.size}`
      : 'Neither INITIAL_ADMIN_EMAILS nor USER_ACCOUNT_ACCESS is configured in the frontend runtime environment.',
  } as const;
}

export function warnIfAccountAccessConfigMissing(): void {
  const check = getAccountAccessStartupCheck();
  if (check.status !== 'warn' || missingConfigWarningLogged) {
    return;
  }

  missingConfigWarningLogged = true;
  serverLogger.warn('auth.account_access_config_missing', {
    warning: ACCOUNT_ACCESS_WARNING,
  });
}

export function getAccountAccessWarningMessage(): string {
  return ACCOUNT_ACCESS_WARNING;
}
