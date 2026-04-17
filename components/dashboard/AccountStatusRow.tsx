'use client';

import type { Account } from '@/types/dashboard';

interface AccountStatusRowProps {
  accounts: Account[];
  onAccountClick?: (accountId: string) => void;
}

export function AccountStatusRow({ accounts, onAccountClick }: AccountStatusRowProps) {
  if (accounts.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
        Account Status
      </h3>
      <div className="flex flex-wrap gap-2">
        {accounts.map((account) => {
          const statusColor = account.isActive ? '#22c55e' : account.lastSeen ? '#f59e0b' : '#ef4444';
          const statusText = account.isActive ? 'Active' : account.lastSeen ? 'Attention' : 'Inactive';

          return (
            <button
              key={account.id}
              type="button"
              onClick={() => onAccountClick?.(account.id)}
              aria-label={`${account.id} status ${statusText}`}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 transition-all hover:border-opacity-50"
              style={{
                background: 'var(--bg-panel)',
                borderColor: 'var(--border)',
              }}
            >
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: statusColor }}
                aria-hidden="true"
              />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {account.id}
              </span>
              <span className="text-xs font-medium" style={{ color: statusColor }}>
                {statusText}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
