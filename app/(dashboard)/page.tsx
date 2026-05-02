// FILE: app/(dashboard)/page.tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { AccountStatusRow } from '@/components/dashboard/AccountStatusRow';
import { RecentActivity } from '@/components/dashboard/RecentActivity';
import { ActivitySquare, AlertTriangle, HeartPulse, Loader2, Mail, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import type { Account, ActivityEntry, HealthSummary, StartupValidationReport } from '@/types/dashboard';
import { getAccounts, getAllAccountsSummary, getHealthSummary, getStartupValidationReport, syncAllMessages } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { timeAgo } from '@/lib/utils';
import { ExportButton } from '@/components/ui/ExportButton';
import { DashboardOverviewSkeleton } from '@/components/ui/SkeletonLoader';
import toast from 'react-hot-toast';

const DASHBOARD_CACHE_KEY = 'linkedin-hyper:dashboard:v1';
const SUMMARY_TTL_MS = 60_000;
const ACCOUNTS_TTL_MS = 5 * 60_000;
const OPERATIONS_TTL_MS = 60_000;

interface DashboardStats {
  totalMessages: number;
  totalConnections: number;
  activeAccounts: number;
  totalActivity: number;
}

interface DashboardCachePayload {
  stats: DashboardStats;
  accounts: Account[];
  activities: ActivityEntry[];
  summaryFetchedAt: number | null;
  accountsFetchedAt: number | null;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalMessages: 0,
    totalConnections: 0,
    activeAccounts: 0,
    totalActivity: 0,
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [summaryFetchedAt, setSummaryFetchedAt] = useState<number | null>(null);
  const [accountsFetchedAt, setAccountsFetchedAt] = useState<number | null>(null);
  const [operationsFetchedAt, setOperationsFetchedAt] = useState<number | null>(null);
  const [dataSource, setDataSource] = useState<'live' | 'session-cache' | null>(null);
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);
  const [startupValidation, setStartupValidation] = useState<StartupValidationReport | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [clockTick, setClockTick] = useState(Date.now());
  const cacheRef = useRef<DashboardCachePayload | null>(null);
  const isMountedRef = useRef(true);
  const dashboardAbortRef = useRef<AbortController | null>(null);
  const operationsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      dashboardAbortRef.current?.abort();
      operationsAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const cached = readDashboardCache();
    if (cached) {
      cacheRef.current = cached;
      applyDashboardPayload(cached, 'session-cache');
      setIsLoading(false);
    }

    const now = Date.now();
    const nextSummaryRefreshIn = cached?.summaryFetchedAt
      ? Math.max(SUMMARY_TTL_MS - (now - cached.summaryFetchedAt), 0)
      : 0;

    const initialTimer = window.setTimeout(() => {
      void fetchDashboardData({ refreshSummary: true, refreshAccounts: !cached?.accountsFetchedAt });
    }, nextSummaryRefreshIn);

    const summaryInterval = window.setInterval(() => {
      void fetchDashboardData({ refreshSummary: true });
    }, SUMMARY_TTL_MS);

    const accountsInterval = window.setInterval(() => {
      void fetchDashboardData({ refreshAccounts: true });
    }, ACCOUNTS_TTL_MS);

    const clockInterval = window.setInterval(() => {
      setClockTick(Date.now());
    }, 30_000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(summaryInterval);
      clearInterval(accountsInterval);
      clearInterval(clockInterval);
    };
  }, []);

  const applyDashboardPayload = useCallback(
    (payload: DashboardCachePayload, source: 'live' | 'session-cache') => {
      if (!isMountedRef.current) return;
      setStats(payload.stats);
      setAccounts(payload.accounts);
      setActivities(payload.activities);
      setSummaryFetchedAt(payload.summaryFetchedAt);
      setAccountsFetchedAt(payload.accountsFetchedAt);
      setDataSource(source);
    },
    []
  );

  const fetchDashboardData = useCallback(async (options?: { refreshSummary?: boolean; refreshAccounts?: boolean }) => {
    const refreshSummary = options?.refreshSummary ?? true;
    const refreshAccounts = options?.refreshAccounts ?? true;
    const cached = cacheRef.current;
    const now = Date.now();

    const shouldFetchSummary =
      refreshSummary ||
      !cached?.summaryFetchedAt ||
      now - cached.summaryFetchedAt >= SUMMARY_TTL_MS;

    const shouldFetchAccounts =
      refreshAccounts ||
      !cached?.accountsFetchedAt ||
      now - cached.accountsFetchedAt >= ACCOUNTS_TTL_MS;

    if (!shouldFetchSummary && !shouldFetchAccounts && cached) {
      applyDashboardPayload(cached, 'session-cache');
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      return;
    }

    dashboardAbortRef.current?.abort();
    const controller = new AbortController();
    dashboardAbortRef.current = controller;

    if (isMountedRef.current) {
      setIsRefreshing(true);
    }

    try {
      const [accountsResult, summaryResult] = await Promise.all([
        shouldFetchAccounts ? getAccounts({ signal: controller.signal }) : Promise.resolve({ accounts: cached?.accounts ?? [] }),
        shouldFetchSummary ? getAllAccountsSummary({ signal: controller.signal }) : Promise.resolve({
          totalMessages: cached?.stats.totalMessages ?? 0,
          totalConnections: cached?.stats.totalConnections ?? 0,
          totalActivity: cached?.stats.totalActivity ?? 0,
          recentActivity: cached?.activities ?? [],
        }),
      ]);

      if (controller.signal.aborted || !isMountedRef.current) {
        return;
      }

      const nextAccounts = accountsResult.accounts;
      const nextStats: DashboardStats = {
        totalMessages: summaryResult.totalMessages || 0,
        totalConnections: summaryResult.totalConnections || 0,
        activeAccounts: nextAccounts.filter((a: Account) => a.isActive).length,
        totalActivity: summaryResult.totalActivity || 0,
      };

      const payload: DashboardCachePayload = {
        stats: nextStats,
        accounts: nextAccounts,
        activities: (summaryResult.recentActivity || []) as ActivityEntry[],
        summaryFetchedAt: shouldFetchSummary ? Date.now() : (cached?.summaryFetchedAt ?? Date.now()),
        accountsFetchedAt: shouldFetchAccounts ? Date.now() : (cached?.accountsFetchedAt ?? Date.now()),
      };

      cacheRef.current = payload;
      writeDashboardCache(payload);
      applyDashboardPayload(payload, 'live');

    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      if (dashboardAbortRef.current === controller) {
        dashboardAbortRef.current = null;
      }
      if (isMountedRef.current && !controller.signal.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [applyDashboardPayload]);

  const loadOperationsHealth = useCallback(async () => {
    operationsAbortRef.current?.abort();
    const controller = new AbortController();
    operationsAbortRef.current = controller;

    if (isMountedRef.current) {
      setIsCheckingHealth(true);
    }
    try {
      const [summary, validation] = await Promise.all([
        getHealthSummary({ signal: controller.signal }),
        getStartupValidationReport({ signal: controller.signal }),
      ]);
      if (controller.signal.aborted || !isMountedRef.current) {
        return;
      }
      setHealthSummary(summary);
      setStartupValidation(validation);
      setOperationsFetchedAt(Date.now());
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.error('Failed to fetch operations health:', err);
    } finally {
      if (operationsAbortRef.current === controller) {
        operationsAbortRef.current = null;
      }
      if (isMountedRef.current && !controller.signal.aborted) {
        setIsCheckingHealth(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadOperationsHealth();
    const interval = window.setInterval(() => {
      void loadOperationsHealth();
    }, OPERATIONS_TTL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [loadOperationsHealth]);

  const greeting = useMemo(() => {
    const hour = new Date(clockTick).getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, [clockTick]);

  const displayName = useMemo(() => {
    const rawName = user?.name?.trim();
    if (!rawName) return 'there';
    return rawName.split(/\s+/)[0] || rawName;
  }, [user?.name]);

  const summaryFreshnessLabel = useMemo(() => {
    if (!summaryFetchedAt) return 'Summary not loaded yet';
    const sourceLabel = dataSource === 'session-cache' ? 'Showing session cache' : 'Live fetch complete';
    return `${sourceLabel}. Last updated ${timeAgo(summaryFetchedAt)}.`;
  }, [dataSource, summaryFetchedAt, clockTick]);

  const accountFreshnessLabel = useMemo(() => {
    if (!accountsFetchedAt) return 'Account status not loaded yet';
    return `Account status last refreshed ${timeAgo(accountsFetchedAt)}.`;
  }, [accountsFetchedAt, clockTick]);

  const operationsFreshnessLabel = useMemo(() => {
    if (!operationsFetchedAt) return 'Operations health not loaded yet';
    return `Operations health last checked ${timeAgo(operationsFetchedAt)}.`;
  }, [operationsFetchedAt, clockTick]);

  const visibleAlerts = useMemo(() => (healthSummary?.alerts || []).slice(0, 4), [healthSummary]);

  const startupValidationLabel = useMemo(() => {
    if (!startupValidation) return 'Startup validation has not run yet.';
    if (startupValidation.status === 'fail') {
      return 'Startup validation found blocking issues.';
    }
    if (startupValidation.status === 'warn') {
      return 'Startup validation found items that need attention.';
    }
    return 'Startup validation passed.';
  }, [startupValidation]);

  const handleSyncNow = useCallback(async () => {
    setIsSyncingNow(true);
    try {
      const result = await syncAllMessages();
      toast.success(result.message || 'Sync started for all accounts');
      await loadOperationsHealth();
      window.setTimeout(() => {
        void Promise.all([
          fetchDashboardData({ refreshSummary: true, refreshAccounts: true }),
          loadOperationsHealth(),
        ]);
      }, 2500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start sync');
    } finally {
      setIsSyncingNow(false);
    }
  }, [fetchDashboardData, loadOperationsHealth]);

  const quickActions = [
    {
      href: '/inbox',
      title: 'Send a message',
      description: 'Jump into Inbox and start a new conversation or reply fast.',
      icon: Mail,
    },
    {
      href: '/notifications',
      title: 'Open activity log',
      description: 'Review the full message, connection, and profile-view history.',
      icon: ActivitySquare,
    },
    {
      href: '/connections',
      title: 'Review network',
      description: 'Check synced LinkedIn connections and recent connection activity.',
      icon: Users,
    },
    {
      href: '/accounts',
      title: 'Refresh sessions',
      description: 'Open account health, refresh expired cookies, and re-verify sessions.',
      icon: ShieldCheck,
    },
  ];

  if (isLoading) {
    return <DashboardOverviewSkeleton />;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
            {greeting}, {displayName}
          </p>
          <h1 className="text-3xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
            Dashboard
          </h1>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            Overview of your LinkedIn automation activity with freshness indicators and quick shortcuts.
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 rounded-xl border px-4 py-3" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            Auto-refresh every minute
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {summaryFreshnessLabel}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {accountFreshnessLabel}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Stats use cached summary data up to 60s old; account status refreshes up to every 5 minutes.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr,1fr]">
        <div
          className="rounded-xl border p-5"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                Session & Sync Health
              </h2>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                {healthSummary?.status === 'critical'
                  ? 'Critical issues need attention before the next live send or sync.'
                  : healthSummary?.status === 'warning'
                    ? 'The system is running, but some accounts need attention.'
                    : 'Sessions and sync look healthy right now.'}
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {operationsFreshnessLabel}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void handleSyncNow()}
                disabled={isSyncingNow}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all disabled:opacity-60"
                style={{ background: 'var(--accent)', color: '#ffffff' }}
              >
                {isSyncingNow ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Sync Now
              </button>
              <button
                onClick={() => void loadOperationsHealth()}
                disabled={isCheckingHealth}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all disabled:opacity-60"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {isCheckingHealth ? <Loader2 size={14} className="animate-spin" /> : <HeartPulse size={14} />}
                Run Health Check
              </button>
              <ExportButton type="activity" label="Export Audit Log" size="sm" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Accounts Needing Attention
              </p>
              <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {healthSummary?.totals.accountsNeedingAttention ?? 0}
              </p>
            </div>
            <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Critical Alerts
              </p>
              <p className="mt-2 text-2xl font-semibold" style={{ color: '#dc2626' }}>
                {healthSummary?.totals.criticalAlerts ?? 0}
              </p>
            </div>
            <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Validation
              </p>
              <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {startupValidationLabel}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {visibleAlerts.length > 0 ? (
              visibleAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-lg border px-4 py-3"
                  style={{
                    borderColor: alert.severity === 'critical' ? 'rgba(220, 38, 38, 0.24)' : 'rgba(245, 158, 11, 0.28)',
                    background: alert.severity === 'critical' ? 'rgba(254, 242, 242, 0.9)' : 'rgba(255, 247, 237, 0.95)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      size={16}
                      style={{ color: alert.severity === 'critical' ? '#dc2626' : '#d97706', marginTop: 2 }}
                    />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {alert.title}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {alert.message}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div
                className="rounded-lg border px-4 py-3"
                style={{ borderColor: 'rgba(16, 185, 129, 0.22)', background: 'rgba(236, 253, 245, 0.9)' }}
              >
                <div className="flex items-start gap-3">
                  <ShieldCheck size={16} style={{ color: '#10b981', marginTop: 2 }} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      No active session or sync alerts
                    </p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Cookie refresh and sync are surfaced in the UI now. Use Accounts for session repair and Sync Now for an on-demand inbox pull.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          className="rounded-xl border p-5"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
            Startup Validation
          </h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-primary)' }}>
            Automated replacement for the curl-based startup checklist.
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {startupValidation ? `Last run ${timeAgo(startupValidation.generatedAt)}.` : 'Validation pending.'}
          </p>

          <div className="mt-4 space-y-2">
            {(startupValidation?.checks || []).slice(0, 5).map((check) => (
              <div key={check.id} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {check.label}
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
                          ? '#059669'
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
      </div>

      {/* Quick Actions */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
            Quick Actions
          </h2>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Start the most common workflows without leaving the dashboard
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="interactive-card rounded-xl border p-5"
              style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
            >
              <div
                className="w-11 h-11 rounded-lg flex items-center justify-center mb-4"
                style={{ background: 'rgba(24, 119, 242, 0.12)', color: 'var(--accent)' }}
              >
                <action.icon size={20} />
              </div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {action.title}
              </h3>
              <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                {action.description}
              </p>
            </Link>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <StatsGrid
        stats={stats}
        summaryPeriodLabel="Message, connection, and activity totals cover all recorded dashboard history."
        summaryFreshnessLabel={summaryFreshnessLabel}
      />

      {/* Account Status */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
            Account Status
          </h2>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Snapshot of managed account sessions
          </span>
        </div>
        <AccountStatusRow accounts={accounts} />
      </div>

      {/* Recent Activity */}
      <RecentActivity
        activities={activities}
        viewAllHref="/notifications"
        freshnessLabel={summaryFreshnessLabel}
      />
    </div>
  );
}

function readDashboardCache(): DashboardCachePayload | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DashboardCachePayload;
  } catch {
    return null;
  }
}

function writeDashboardCache(payload: DashboardCachePayload): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore session storage errors and keep runtime state only.
  }
}
