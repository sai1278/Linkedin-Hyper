'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, HeartPulse, Loader2, RefreshCw, TerminalSquare } from 'lucide-react';
import { getHealthSummary, getStartupValidationReport } from '@/lib/api-client';
import type { HealthSummary, StartupValidationReport } from '@/types/dashboard';
import { timeAgo } from '@/lib/utils';

const REFRESH_MS = 60_000;

const OPERATOR_SHORTCUTS = [
  { label: 'Deploy', command: 'make deploy' },
  { label: 'Status', command: 'make status' },
  { label: 'Logs (all)', command: 'make logs' },
  { label: 'Logs (worker)', command: 'make logs-worker' },
  { label: 'Backup all', command: 'make backup-all' },
  { label: 'Rollback', command: 'make rollback REF=main~1' },
] as const;

export default function StatusPage() {
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [validation, setValidation] = useState<StartupValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(Date.now());

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextHealth, nextValidation] = await Promise.all([
        getHealthSummary(),
        getStartupValidationReport(),
      ]);
      setHealth(nextHealth);
      setValidation(nextValidation);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshInterval = window.setInterval(() => {
      void load();
    }, REFRESH_MS);
    const clockInterval = window.setInterval(() => {
      setTick(Date.now());
    }, 30_000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(clockInterval);
    };
  }, [load]);

  const statusTone = useMemo(() => {
    if (health?.status === 'critical') {
      return { bg: 'rgba(254, 242, 242, 0.95)', border: 'rgba(220, 38, 38, 0.22)', color: '#b91c1c', label: 'Critical' };
    }
    if (health?.status === 'warning') {
      return { bg: 'rgba(255, 247, 237, 0.95)', border: 'rgba(245, 158, 11, 0.24)', color: '#b45309', label: 'Warning' };
    }
    return { bg: 'rgba(236, 253, 245, 0.95)', border: 'rgba(16, 185, 129, 0.2)', color: '#047857', label: 'Healthy' };
  }, [health?.status]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="mx-auto mb-3 animate-spin" style={{ color: 'var(--accent)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading status page...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Status
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Health dashboard for sessions, sync, startup validation, and operator shortcuts.
          </p>
        </div>

        <button
          onClick={() => void load()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all disabled:opacity-60"
          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          Refresh Status
        </button>
      </div>

      <div
        className="rounded-2xl border p-5"
        style={{ background: statusTone.bg, borderColor: statusTone.border }}
      >
        <div className="flex items-start gap-3">
          <HeartPulse size={18} style={{ color: statusTone.color, marginTop: 2 }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: statusTone.color }}>
              Overall Status: {statusTone.label}
            </p>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-primary)' }}>
              {health?.status === 'critical'
                ? 'One or more accounts need immediate session or sync attention.'
                : health?.status === 'warning'
                  ? 'The system is running, but some accounts are stale or degraded.'
                  : 'All monitored operational checks look healthy right now.'}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Last updated {health?.generatedAt ? timeAgo(health.generatedAt) : 'just now'}.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ['Managed accounts', String(health?.totals.totalAccounts ?? 0)],
          ['Accounts with session', String(health?.totals.accountsWithSession ?? 0)],
          ['Critical alerts', String(health?.totals.criticalAlerts ?? 0)],
          ['Warnings', String(health?.totals.warningAlerts ?? 0)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border px-4 py-4"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr,1fr]">
        <div
          className="rounded-xl border p-5"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                Startup Validation
              </h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                Automated replacement for manual curl startup checks.
              </p>
            </div>
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
              style={{
                background:
                  validation?.status === 'pass'
                    ? 'rgba(16, 185, 129, 0.14)'
                    : validation?.status === 'warn'
                      ? 'rgba(245, 158, 11, 0.14)'
                      : 'rgba(220, 38, 38, 0.12)',
                color:
                  validation?.status === 'pass'
                    ? '#047857'
                    : validation?.status === 'warn'
                      ? '#b45309'
                      : '#b91c1c',
              }}
            >
              {validation?.status ?? 'unknown'}
            </span>
          </div>

          <div className="space-y-3">
            {(validation?.checks || []).map((check) => (
              <div
                key={check.id}
                className="rounded-lg border px-4 py-3"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {check.title ?? check.label}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                    style={{
                      background:
                        check.status === 'pass'
                          ? 'rgba(16, 185, 129, 0.14)'
                          : check.status === 'warn'
                            ? 'rgba(245, 158, 11, 0.14)'
                            : 'rgba(220, 38, 38, 0.12)',
                      color:
                        check.status === 'pass'
                          ? '#047857'
                          : check.status === 'warn'
                            ? '#b45309'
                            : '#b91c1c',
                    }}
                  >
                    {check.status}
                  </span>
                </div>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {check.detail}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-xl border p-5"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <TerminalSquare size={16} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
              Operator Shortcuts
            </h2>
          </div>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            One-command shortcuts for deploy, logs, backups, and rollback.
          </p>

          <div className="mt-4 space-y-3">
            {OPERATOR_SHORTCUTS.map((shortcut) => (
              <div key={shortcut.label} className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {shortcut.label}
                </p>
                <code className="mt-2 block rounded-md px-3 py-2 text-xs" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                  {shortcut.command}
                </code>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4 flex items-center gap-2">
          {health?.alerts?.length ? (
            <AlertTriangle size={16} style={{ color: '#d97706' }} />
          ) : (
            <CheckCircle2 size={16} style={{ color: '#059669' }} />
          )}
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
            Account Health Detail
          </h2>
        </div>

        <div className="space-y-3">
          {(health?.accounts || []).map((account) => (
            <div key={account.accountId} className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {account.displayName}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    Session {account.hasSession ? 'available' : 'missing'} • Last sync status: {account.lastSyncStatus}
                  </p>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                  style={{
                    background:
                      account.severity === 'healthy'
                        ? 'rgba(16, 185, 129, 0.14)'
                        : account.severity === 'warning'
                          ? 'rgba(245, 158, 11, 0.14)'
                          : 'rgba(220, 38, 38, 0.12)',
                    color:
                      account.severity === 'healthy'
                        ? '#047857'
                        : account.severity === 'warning'
                          ? '#b45309'
                          : '#b91c1c',
                  }}
                >
                  {account.severity}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
                <span style={{ color: 'var(--text-muted)' }}>
                  Last session save: {account.lastSessionSavedAt ? timeAgo(account.lastSessionSavedAt) : 'never'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  Last sync finish: {account.lastSyncCompletedAt ? timeAgo(account.lastSyncCompletedAt) : 'never'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  Source: {account.lastSyncSource || 'n/a'}
                </span>
              </div>

              {(account.sessionIssue || account.lastSyncError) && (
                <p className="mt-3 text-xs" style={{ color: '#b45309' }}>
                  {account.sessionIssue?.message || account.lastSyncError}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
