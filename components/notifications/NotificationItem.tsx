'use client';

import type { ActivityEntry } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { timeAgo } from '@/lib/utils';
import { MessageSquare, UserPlus, Eye } from 'lucide-react';

const TYPE_META: Record<
  ActivityEntry['type'],
  { icon: React.ComponentType<{ size: number; color: string }>; label: string; color: string }
> = {
  messageSent:    { icon: MessageSquare, label: 'Message sent',    color: '#8b7cf8' },
  connectionSent: { icon: UserPlus,      label: 'Connection sent', color: '#22c55e' },
  profileViewed:  { icon: Eye,           label: 'Profile viewed',  color: '#f59e0b' },
};

export function NotificationRow({ entry }: { entry: ActivityEntry }) {
  const meta = TYPE_META[entry.type];
  const Icon = meta.icon;

  return (
    <div
      className="flex items-start gap-3 px-6 py-4 transition-colors cursor-default"
      style={{ borderBottom: '1px solid var(--border)' }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)')
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLDivElement).style.background = 'transparent')
      }
    >
      {/* Avatar with type icon overlay */}
      <div className="relative flex-shrink-0">
        <Avatar name={entry.targetName} size="sm" />
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full p-0.5"
          style={{ background: 'var(--bg-panel)' }}
        >
          <Icon size={10} color={meta.color} />
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {entry.targetName}
          </span>
          <AccountBadge name={entry.accountId} />
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          <span style={{ color: meta.color }}>{meta.label}</span>
          {entry.message ? ` — ${entry.message.slice(0, 80)}${entry.message.length > 80 ? '…' : ''}` : ''}
        </p>
        {entry.targetProfileUrl && (
          <a
            href={entry.targetProfileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] mt-0.5 inline-block truncate max-w-[200px]"
            style={{ color: 'var(--text-link)' }}
          >
            {entry.targetProfileUrl.replace('https://linkedin.com/in/', '').replace(/\/$/, '')}
          </a>
        )}
      </div>

      {/* Time */}
      <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }}>
        {timeAgo(entry.timestamp)}
      </span>
    </div>
  );
}
