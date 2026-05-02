'use client';

import type { ActivityEntry } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { timeAgo } from '@/lib/utils';
import { deriveDisplayName } from '@/lib/display-name';
import { Eye, MessageSquare, RefreshCw, UserPlus } from 'lucide-react';
import { formatAccountLabel } from '@/lib/account-label';

const TYPE_META: Record<
  string,
  {
    icon: React.ComponentType<{ size: number; color: string }>;
    label: string;
    color: string;
  }
> = {
  messageSent: { icon: MessageSquare, label: 'Message sent', color: '#8b7cf8' },
  connectionSent: { icon: UserPlus, label: 'Connection sent', color: '#22c55e' },
  profileViewed: { icon: Eye, label: 'Profile viewed', color: '#f59e0b' },
  sync: { icon: RefreshCw, label: 'Sync completed', color: '#166fe5' },
};

function formatActivityLabel(type: string): string {
  const normalized = String(type || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!normalized) return 'Activity';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function NotificationRow({ entry }: { entry: ActivityEntry }) {
  const meta = TYPE_META[entry.type] || {
    icon: RefreshCw,
    label: formatActivityLabel(entry.type),
    color: '#6b7280',
  };
  const Icon = meta.icon;
  const displayName = entry.targetName
    ? deriveDisplayName(entry.targetName, entry.targetProfileUrl || '')
    : formatAccountLabel(entry.accountId);
  const messagePreview = entry.message
    ? ` - ${entry.message.slice(0, 80)}${entry.message.length > 80 ? '...' : ''}`
    : entry.type === 'sync'
      ? ' - Background sync recorded for this account.'
      : '';

  return (
    <div
      className="interactive-row flex items-start gap-3 px-6 py-4"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <div className="relative flex-shrink-0">
        <Avatar name={displayName} size="sm" />
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full p-0.5"
          style={{ background: 'var(--bg-panel)' }}
        >
          <Icon size={10} color={meta.color} />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {displayName}
          </span>
          <AccountBadge name={formatAccountLabel(entry.accountId)} />
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span style={{ color: meta.color }}>{meta.label}</span>
          {messagePreview}
        </p>
        {entry.targetProfileUrl && (
          <a
            href={entry.targetProfileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-block max-w-[200px] truncate text-[11px]"
            style={{ color: 'var(--text-link)' }}
          >
            {entry.targetProfileUrl
              .replace('https://linkedin.com/in/', '')
              .replace('https://www.linkedin.com/in/', '')
              .replace(/\/$/, '')}
          </a>
        )}
      </div>

      <span
        className="mt-0.5 flex-shrink-0 text-[10px]"
        style={{ color: 'var(--text-muted)' }}
      >
        {timeAgo(entry.timestamp)}
      </span>
    </div>
  );
}
