// FILE: components/dashboard/AccountStatusRow.tsx
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
      <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
        Account Status
      </h3>
      <div className="flex flex-wrap gap-2">
        {accounts.map((account) => {
          const statusColor = account.isActive ? '#22c55e' : account.lastSeen ? '#f59e0b' : '#ef4444';
          const statusIcon = account.isActive ? '✓' : account.lastSeen ? '⚠' : '✕';

          return (
            <button
              key={account.id}
              onClick={() => onAccountClick?.(account.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border transition-all hover:border-opacity-50"
              style={{ 
                background: 'var(--bg-panel)', 
                borderColor: 'var(--border)',
              }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: statusColor }}
              />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {account.id}
              </span>
              <span className="text-xs" style={{ color: statusColor }}>
                {statusIcon}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
