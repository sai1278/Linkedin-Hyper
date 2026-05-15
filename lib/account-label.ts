import type { Account } from '@/types/dashboard';

function normalizeLabel(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function formatAccountLabel(value: string): string {
  const normalized = normalizeLabel(value);
  if (!normalized) return 'Account';

  const spaced = normalized
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2');

  return spaced
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getAccountLabel(account: Pick<Account, 'id' | 'displayName'>): string {
  const displayName = normalizeLabel(account.displayName);
  const id = normalizeLabel(account.id);

  if (displayName && displayName.toLowerCase() !== id.toLowerCase()) {
    return displayName;
  }

  return formatAccountLabel(displayName || id);
}
