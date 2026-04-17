// FILE: components/dashboard/RecentActivity.tsx
'use client';

import Link from 'next/link';
import { MessageSquare, UserPlus, Eye, ExternalLink } from 'lucide-react';
import type { ActivityEntry } from '@/types/dashboard';
import { deriveDisplayName } from '@/lib/display-name';

interface RecentActivityProps {
  activities: ActivityEntry[];
  viewAllHref: string;
  freshnessLabel: string;
}

export function RecentActivity({ activities, viewAllHref, freshnessLabel }: RecentActivityProps) {
  const getIcon = (type: ActivityEntry['type']) => {
    switch (type) {
      case 'messageSent':
        return MessageSquare;
      case 'connectionSent':
        return UserPlus;
      case 'profileViewed':
        return Eye;
      default:
        return MessageSquare;
    }
  };

  const getTypeLabel = (type: ActivityEntry['type']) => {
    switch (type) {
      case 'messageSent':
        return 'Message';
      case 'connectionSent':
        return 'Connection';
      case 'profileViewed':
        return 'View';
      default:
        return 'Activity';
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  if (activities.length === 0) {
    return (
      <div
        className="rounded-xl border p-8 text-center"
        style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No recent activity
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
    >
      <div className="p-4 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            Recent Activity
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Latest 10 deduped activity entries. {freshnessLabel}
          </p>
        </div>
        <Link
          href={viewAllHref}
          className="text-sm font-medium transition-opacity hover:opacity-80"
          style={{ color: 'var(--accent)' }}
        >
          View full activity
        </Link>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {activities.slice(0, 10).map((activity, index) => {
          const Icon = getIcon(activity.type);
          const displayName = deriveDisplayName(activity.targetName, activity.targetProfileUrl || '');
          
          return (
            <div
              key={index}
              className="p-4 flex items-center gap-4 hover:bg-opacity-50 transition-all"
              style={{ background: 'transparent' }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <Icon size={18} style={{ color: 'var(--accent)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {getTypeLabel(activity.type)}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                    {activity.accountId}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                    {displayName}
                  </p>
                  {activity.targetProfileUrl && (
                    <a
                      href={activity.targetProfileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0"
                      aria-label={`Open LinkedIn profile for ${displayName}`}
                      style={{ color: 'var(--accent)' }}
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
                {activity.message && (
                  <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
                    {activity.message}
                  </p>
                )}
              </div>
              <div className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                {formatTimestamp(activity.timestamp)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
