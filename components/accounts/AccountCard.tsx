'use client';

import { SessionStatus } from './SessionStatus';
import { RateLimitBar } from '../dashboard/RateLimitBar';
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { Account } from '@/types/dashboard';
import type { AccountRateLimits, AccountSessionStatus } from '@/lib/api-client';
import type { DerivedAccountHealth } from '@/lib/account-health';
import { formatRelativeDate } from '@/lib/account-health';

interface AccountCardProps {
  account: Account;
  label: string;
  health: DerivedAccountHealth;
  sessionStatus: AccountSessionStatus | null;
  rateLimits: AccountRateLimits | null;
  messagesSent: number;
  lastSyncedAt: number | null;
  isVerifying: boolean;
  isDeleting: boolean;
  onVerify: (accountId: string) => void;
  onDelete: (accountId: string) => void;
  onImport: (accountId: string) => void;
}

export function AccountCard({
  account,
  label,
  health,
  sessionStatus,
  rateLimits,
  messagesSent,
  lastSyncedAt,
  isVerifying,
  isDeleting,
  onVerify,
  onDelete,
  onImport,
}: AccountCardProps) {
  const hasSession = Boolean(sessionStatus?.exists);
  const sessionAgeText = hasSession && sessionStatus?.savedAt
    ? formatRelativeDate(sessionStatus.savedAt)
    : 'No session';
  const lastSyncedText = lastSyncedAt ? formatRelativeDate(lastSyncedAt) : 'Not synced yet';

  return (
    <div
      className="space-y-4 rounded-2xl border p-5"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {label}
          </h3>
          <p className="mt-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            {account.id}
          </p>
        </div>
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold"
          style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)', color: 'white' }}
        >
          {label.substring(0, 2).toUpperCase()}
        </div>
      </div>

      <SessionStatus
        label={health.label}
        color={health.color}
        detail={health.description}
      />

      {health.key !== 'healthy' && (
        <div
          className="flex items-start gap-2 rounded-xl px-3 py-3"
          style={{
            background: health.key === 'expired' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.12)',
            border: `1px solid ${health.key === 'expired' ? 'rgba(239, 68, 68, 0.24)' : 'rgba(245, 158, 11, 0.24)'}`,
          }}
        >
          <AlertTriangle size={16} style={{ color: health.color, flexShrink: 0, marginTop: 2 }} />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Action recommended
            </p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Refresh cookies before inbox names go unknown or sends start failing silently.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Cookie age" value={sessionAgeText} />
        <MetricCard label="Last synced" value={lastSyncedText} />
        <MetricCard label="Messages today" value={String(messagesSent)} />
      </div>

      {rateLimits && (
        <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
          {rateLimits.messagesSent && (
            <RateLimitBar
              label="Messages Sent"
              current={rateLimits.messagesSent.current}
              limit={rateLimits.messagesSent.limit}
              resetsAt={rateLimits.messagesSent.resetsAt}
            />
          )}
          {rateLimits.connectRequests && (
            <RateLimitBar
              label="Connection Requests"
              current={rateLimits.connectRequests.current}
              limit={rateLimits.connectRequests.limit}
              resetsAt={rateLimits.connectRequests.resetsAt}
            />
          )}
        </div>
      )}

      <div className="flex gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => onImport(account.id)}
          className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          {hasSession ? 'Refresh Cookies' : 'Import Cookies'}
        </button>
        <button
          onClick={() => onVerify(account.id)}
          disabled={isVerifying}
          className="rounded-lg border px-3 py-2 text-sm font-medium transition-all disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          title="Verify this session"
        >
          {isVerifying ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
        <button
          onClick={() => onDelete(account.id)}
          disabled={isDeleting}
          className="rounded-lg border px-3 py-2 text-sm font-medium transition-all disabled:opacity-50"
          style={{ borderColor: '#ef4444', color: '#ef4444' }}
          title="Delete this session"
        >
          {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
        </button>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-3" style={{ background: 'var(--bg-elevated)' }}>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  );
}
