'use client';

import type { Connection, Account } from '@/types/dashboard';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { Avatar } from '@/components/ui/Avatar';
import { timeAgo } from '@/lib/utils';
import { ExternalLink, RefreshCw, Search, Star } from 'lucide-react';

type ConnectionSort = 'recent' | 'name' | 'account' | 'important';

type ConnectionRow = Connection & {
  rowKey: string;
  accountLabel: string;
  important: boolean;
  note: string;
};

interface ConnectionGridProps {
  connections: ConnectionRow[];
  accounts: Account[];
  accountLabels: Record<string, string>;
  total: number;
  liveCount: number;
  activityCount: number;
  search: string;
  filter: string;
  sort: ConnectionSort;
  syncing: boolean;
  title: string;
  subtitle: string;
  onSearchChange: (q: string) => void;
  onFilterChange: (f: string) => void;
  onSortChange: (value: ConnectionSort) => void;
  onSync: () => void;
  onToggleImportant: (rowKey: string) => void;
  onNoteChange: (rowKey: string, note: string) => void;
}

function getSourceLabel(source?: Connection['source']): string {
  if (source === 'linkedin') return 'Live LinkedIn';
  if (source === 'connectionSent') return 'Tool activity';
  return 'Unknown source';
}

function getSourceTone(source?: Connection['source']): { background: string; color: string } {
  if (source === 'linkedin') {
    return { background: 'rgba(16, 185, 129, 0.12)', color: '#047857' };
  }

  if (source === 'connectionSent') {
    return { background: 'rgba(24, 119, 242, 0.12)', color: '#166fe5' };
  }

  return { background: 'rgba(107, 114, 128, 0.12)', color: '#4b5563' };
}

export function ConnectionGrid({
  connections,
  accounts,
  accountLabels,
  total,
  liveCount,
  activityCount,
  search,
  filter,
  sort,
  syncing,
  title,
  subtitle,
  onSearchChange,
  onFilterChange,
  onSortChange,
  onSync,
  onToggleImportant,
  onNoteChange,
}: ConnectionGridProps) {
  const hasAnyConnections = total > 0;
  const isFilteredEmpty = hasAnyConnections && connections.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-start justify-between gap-4 px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h1>
            <span
              className="rounded-full px-2 py-0.5 text-sm font-medium"
              style={{ background: 'var(--badge-purple)', color: 'var(--badge-text)' }}
            >
              {total}
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full px-2 py-1" style={{ background: 'rgba(16, 185, 129, 0.12)', color: '#047857' }}>
              Live LinkedIn: {liveCount}
            </span>
            <span className="rounded-full px-2 py-1" style={{ background: 'rgba(24, 119, 242, 0.12)', color: '#166fe5' }}>
              Tool activity: {activityCount}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              Notes and important marks stay in this browser.
            </span>
          </div>
        </div>

        <button
          onClick={onSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all"
          style={{
            background: 'var(--accent)',
            color: '#ffffff',
            cursor: syncing ? 'wait' : 'pointer',
            opacity: syncing ? 0.8 : 1,
          }}
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing network...' : 'Sync LinkedIn network'}
        </button>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-1.5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          >
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Search people, notes, or headline"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="w-44 bg-transparent text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Sort
            </label>
            <select
              value={sort}
              onChange={(event) => onSortChange(event.target.value as ConnectionSort)}
              className="rounded-lg px-3 py-1.5 text-sm outline-none"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="recent">Most recent</option>
              <option value="name">Name</option>
              <option value="account">Account</option>
              <option value="important">Important first</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {['all', ...accounts.map((account) => account.id)].map((accountId) => {
            const isActive = filter === accountId;
            return (
              <button
                key={accountId}
                onClick={() => onFilterChange(accountId)}
                className="rounded-full px-3 py-1 text-sm font-medium transition-colors"
                style={{
                  background: isActive ? 'var(--accent)' : 'var(--bg-card)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  border: '1px solid',
                  borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                  cursor: 'pointer',
                }}
              >
                {accountId === 'all' ? 'All Accounts' : (accountLabels[accountId] ?? accountId)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!hasAnyConnections ? (
          <div className="flex h-56 flex-col items-center justify-center px-6 text-center">
            <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              No LinkedIn network data yet
            </p>
            <p className="mt-2 max-w-xl text-sm" style={{ color: 'var(--text-muted)' }}>
              This page fills from live LinkedIn connection sync plus recent connection activity. Click
              {' '}
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Sync LinkedIn network</span>
              {' '}
              to pull the current network into the dashboard.
            </p>
          </div>
        ) : isFilteredEmpty ? (
          <div className="flex h-48 flex-col items-center justify-center px-6 text-center">
            <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              No matching connections
            </p>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              Try a different search, account filter, or sort option.
            </p>
          </div>
        ) : (
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Person', 'Account', 'Source', 'Connected', 'Notes', 'Profile'].map((header) => (
                  <th
                    key={header}
                    className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)', background: 'var(--bg-panel)' }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => {
                const sourceTone = getSourceTone(connection.source);
                return (
                  <tr
                    key={connection.rowKey}
                    className="transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td className="px-6 py-3 align-top">
                      <div className="flex items-start gap-3">
                        <Avatar name={connection.name} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onToggleImportant(connection.rowKey)}
                              className="rounded-full p-1 transition-all"
                              title={connection.important ? 'Remove important mark' : 'Mark as important'}
                              style={{
                                color: connection.important ? '#f59e0b' : 'var(--text-muted)',
                                background: connection.important ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                              }}
                            >
                              <Star size={14} fill={connection.important ? 'currentColor' : 'none'} />
                            </button>
                            <span className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                              {connection.name}
                            </span>
                          </div>
                          {connection.headline ? (
                            <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                              {connection.headline}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3 align-top">
                      <AccountBadge name={connection.accountLabel} />
                    </td>
                    <td className="px-6 py-3 align-top">
                      <span
                        className="inline-flex rounded-full px-2 py-1 text-xs font-medium"
                        style={{ background: sourceTone.background, color: sourceTone.color }}
                      >
                        {getSourceLabel(connection.source)}
                      </span>
                    </td>
                    <td className="px-6 py-3 align-top">
                      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {connection.connectedAt ? timeAgo(connection.connectedAt) : 'Live sync'}
                      </span>
                    </td>
                    <td className="px-6 py-3 align-top">
                      <input
                        type="text"
                        value={connection.note}
                        onChange={(event) => onNoteChange(connection.rowKey, event.target.value)}
                        placeholder="Add a note"
                        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </td>
                    <td className="px-6 py-3 align-top">
                      {connection.profileUrl ? (
                        <a
                          href={connection.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm"
                          style={{ color: 'var(--text-link)' }}
                        >
                          <ExternalLink size={12} />
                          View
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
