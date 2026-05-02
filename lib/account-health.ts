export type AccountHealthKey = 'healthy' | 'expiringSoon' | 'degraded' | 'expired';

export interface DerivedAccountHealth {
  key: AccountHealthKey;
  label: string;
  color: string;
  description: string;
}

interface AccountHealthInput {
  hasSession: boolean;
  sessionAgeSeconds?: number;
  lastSyncedAt?: number | null;
}

const ONE_DAY_SECONDS = 86_400;

export function deriveAccountHealth({
  hasSession,
  sessionAgeSeconds = 0,
  lastSyncedAt = null,
}: AccountHealthInput): DerivedAccountHealth {
  if (!hasSession) {
    return {
      key: 'expired',
      label: 'Expired',
      color: '#dc2626',
      description: 'No valid session is stored. Refresh cookies before inbox and sync features can work again.',
    };
  }

  if (sessionAgeSeconds >= 14 * ONE_DAY_SECONDS) {
    return {
      key: 'degraded',
      label: 'Degraded',
      color: '#ea580c',
      description: 'This session is old enough that LinkedIn may start failing silently. Refresh cookies soon.',
    };
  }

  if (sessionAgeSeconds >= 7 * ONE_DAY_SECONDS) {
    return {
      key: 'expiringSoon',
      label: 'Expiring Soon',
      color: '#d97706',
      description: 'Session still exists, but it is aging. Refresh cookies before sends, inbox names, or sync start drifting.',
    };
  }

  if (lastSyncedAt && Date.now() - lastSyncedAt > 3 * ONE_DAY_SECONDS * 1000) {
    return {
      key: 'degraded',
      label: 'Degraded',
      color: '#ea580c',
      description: 'No recent account activity was synced. Run a sync and verify the session if the inbox looks stale.',
    };
  }

  return {
    key: 'healthy',
    label: 'Healthy',
    color: '#16a34a',
    description: 'Session age and recent activity both look healthy.',
  };
}

export function formatRelativeDate(input?: number | string | null): string {
  if (!input) return 'Never';

  const timestamp = typeof input === 'number' ? input : new Date(input).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown';

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;

  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}
