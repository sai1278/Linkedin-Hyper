'use client';

import type { Connection, Account } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { timeAgo } from '@/lib/utils';
import { Search, ExternalLink } from 'lucide-react';

interface ConnectionGridProps {
  connections: Connection[];
  accounts: Account[];
  total: number;
  search: string;
  filter: string;
  onSearchChange: (q: string) => void;
  onFilterChange: (f: string) => void;
}

export function ConnectionGrid({
  connections,
  accounts,
  total,
  search,
  filter,
  onSearchChange,
  onFilterChange,
}: ConnectionGridProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Connections
          </h1>
          <span
            className="text-sm font-medium px-2 py-0.5 rounded-full"
            style={{ background: 'var(--badge-purple)', color: 'var(--badge-text)' }}
          >
            {total}
          </span>
        </div>
        {/* Search input */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
        >
          <Search size={14} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="bg-transparent text-sm outline-none w-36"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      {/* Account filter pills */}
      <div
        className="flex gap-2 px-6 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {['all', ...accounts.map((a) => a.id)].map((acc) => {
          const isActive = filter === acc;
          return (
            <button
              key={acc}
              onClick={() => onFilterChange(acc)}
              className="px-3 py-1 rounded-full text-sm font-medium transition-colors"
              style={{
                background:  isActive ? 'var(--accent)' : 'var(--bg-card)',
                color:       isActive ? '#fff'          : 'var(--text-muted)',
                border:      '1px solid',
                borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                cursor:      'pointer',
              }}
            >
              {acc === 'all' ? 'All Accounts' : acc}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {connections.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <p style={{ color: 'var(--text-muted)' }}>
              No connections found yet
            </p>
          </div>
        ) : (
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Person', 'Account', 'Connected', 'Profile'].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)', background: 'var(--bg-panel)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {connections.map((conn, idx) => (
                <tr
                  key={`${conn.accountId}-${conn.profileUrl}-${idx}`}
                  // F2 — CSS hover instead of direct style mutation (no layout thrash)
                  className="hover:bg-[var(--bg-hover)] transition-colors"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={conn.name} size="sm" />
                      <span
                        className="text-sm font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {conn.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <AccountBadge name={conn.accountId} />
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {conn.connectedAt ? timeAgo(conn.connectedAt) : '—'}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    {conn.profileUrl ? (
                      <a
                        href={conn.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm"
                        style={{ color: 'var(--text-link)' }}
                      >
                        <ExternalLink size={12} />
                        View
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
