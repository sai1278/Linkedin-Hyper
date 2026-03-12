'use client';

import type { ActivityEntry, Account, ActivityTab } from '@/types/dashboard';
import { NotificationRow } from './NotificationItem';
import { AccountBadge } from '@/components/ui/AccountBadge';

const TABS: { id: ActivityTab; label: string }[] = [
  { id: 'all',             label: 'All' },
  { id: 'messageSent',     label: 'Messages' },
  { id: 'connectionSent',  label: 'Connections' },
  { id: 'profileViewed',   label: 'Profile Views' },
];

interface NotificationFeedProps {
  entries: ActivityEntry[];
  accounts: Account[];
  activeTab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
  totalUnread: number;
}

export function NotificationFeed({
  entries,
  accounts: _accounts,
  activeTab,
  onTabChange,
  totalUnread,
}: NotificationFeedProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Activity Feed
          </h1>
          {totalUnread > 0 && (
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
              style={{ background: '#6c63ff' }}
            >
              {totalUnread} entries
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {_accounts.map((a) => (
            <AccountBadge key={a.id} name={a.id} />
          ))}
        </div>
      </div>

      {/* Tab filter */}
      <div className="flex gap-1 px-6 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        {TABS.map(({ id, label }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: isActive ? 'var(--accent)' : 'var(--bg-card)',
                color: isActive ? '#fff' : 'var(--text-muted)',
                border: '1px solid',
                borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <p style={{ color: 'var(--text-muted)' }}>No activity entries</p>
          </div>
        ) : (
          entries.map((entry, idx) => (
            <NotificationRow key={`${entry.accountId}-${entry.timestamp}-${idx}`} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
