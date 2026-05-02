const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isEnabled(value: string | undefined | null): boolean {
  return TRUE_VALUES.has(String(value || '').trim().toLowerCase());
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isLegacyAuthAllowed(): boolean {
  if (!isProductionRuntime()) {
    return true;
  }
  return isEnabled(process.env.ALLOW_LEGACY_AUTH);
}

export function isStaticServiceTokenAllowed(): boolean {
  if (!isProductionRuntime()) {
    return true;
  }
  return isEnabled(process.env.ALLOW_STATIC_SERVICE_TOKENS);
}
