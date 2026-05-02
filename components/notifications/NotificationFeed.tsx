'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { ActivityEntry, Account, ActivityTab } from '@/types/dashboard';
import { NotificationRow } from './NotificationItem';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { getAccountLabel } from '@/lib/account-label';

const TABS: { id: ActivityTab; label: string }[] = [
  { id: 'all',            label: 'All'           },
  { id: 'messageSent',    label: 'Messages'      },
  { id: 'connectionSent', label: 'Connections'   },
  { id: 'profileViewed',  label: 'Profile Views' },
  { id: 'sync',           label: 'Sync'          },
];

interface NotificationFeedProps {
  entries: ActivityEntry[];
  accounts: Account[];
  activeTab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
  totalUnread: number;
  title: string;
  canLoadMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export function NotificationFeed({
  entries,
  accounts,
  activeTab,
  onTabChange,
  totalUnread,
  title,
  canLoadMore = false,
  isLoadingMore = false,
  onLoadMore,
}: NotificationFeedProps) {
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLowerCase();

    return entries.filter((entry) => {
      if (accountFilter !== 'all' && entry.accountId !== accountFilter) {
        return false;
      }

      if (!query) return true;

      return [
        entry.targetName,
        entry.targetProfileUrl,
        entry.message,
        entry.accountId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [accountFilter, entries, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          {totalUnread > 0 && (
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
              style={{ background: 'var(--accent)' }}
            >
              {totalUnread} entries
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {accounts.map((a) => (
            <AccountBadge key={a.id} name={getAccountLabel(a)} />
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 px-6 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {TABS.map(({ id, label }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background:  isActive ? 'var(--accent)'  : 'var(--bg-card)',
                color:       isActive ? '#fff'           : 'var(--text-muted)',
                border:      '1px solid',
                borderColor: isActive ? 'var(--accent)'  : 'var(--border)',
                cursor:      'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2 md:w-[320px]"
          style={{
            backgroundColor: 'var(--bg-primary, var(--color-gray-50))',
            border: '1px solid var(--border)',
          }}
        >
          <Search size={14} style={{ color: 'var(--text-muted-new, var(--text-muted))' }} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search names, profiles, or message text"
            aria-label="Search activity log"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: 'var(--text-primary-new, var(--text-primary))' }}
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            Account
          </label>
          <select
            value={accountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            aria-label="Filter activity by account"
            className="rounded-xl px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: 'var(--bg-secondary, var(--bg-card))',
              border: '1px solid var(--border)',
              color: 'var(--text-primary-new, var(--text-primary))',
            }}
          >
            <option value="all">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName || account.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {visibleEntries.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <p style={{ color: 'var(--text-muted)' }}>
              {search.trim() || accountFilter !== 'all'
                ? 'No activity matches this filter yet'
                : 'No activity entries'}
            </p>
          </div>
        ) : (
          visibleEntries.map((entry, idx) => (
            <NotificationRow
              key={`${entry.accountId}-${entry.timestamp}-${idx}`}
              entry={entry}
            />
          ))
        )}
      </div>

      {canLoadMore && (
        <div className="border-t px-6 py-4" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="button-outline w-full rounded-xl px-4 py-2.5 text-sm font-medium"
            style={{
              cursor: isLoadingMore ? 'wait' : 'pointer',
              opacity: isLoadingMore ? 0.75 : 1,
            }}
          >
            {isLoadingMore ? 'Loading older activity...' : 'Load older activity'}
          </button>
        </div>
      )}
    </div>
  );
}
