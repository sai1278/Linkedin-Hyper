'use client';

import type { ActivityEntry } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { timeAgo } from '@/lib/utils';
import { deriveDisplayName } from '@/lib/display-name';
import { Eye, MessageSquare, UserPlus } from 'lucide-react';

const TYPE_META: Record<
  ActivityEntry['type'],
  {
    icon: React.ComponentType<{ size: number; color: string }>;
    label: string;
    color: string;
  }
> = {
  messageSent: { icon: MessageSquare, label: 'Message sent', color: '#8b7cf8' },
  connectionSent: { icon: UserPlus, label: 'Connection sent', color: '#22c55e' },
  profileViewed: { icon: Eye, label: 'Profile viewed', color: '#f59e0b' },
};

export function NotificationRow({ entry }: { entry: ActivityEntry }) {
  const meta = TYPE_META[entry.type];
  const Icon = meta.icon;
  const displayName = deriveDisplayName(entry.targetName, entry.targetProfileUrl || '');
  const messagePreview = entry.message
    ? ` - ${entry.message.slice(0, 80)}${entry.message.length > 80 ? '...' : ''}`
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
          <AccountBadge name={entry.accountId} />
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
