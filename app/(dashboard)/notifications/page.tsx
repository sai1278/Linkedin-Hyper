'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ActivityEntry, Account, ActivityTab } from '@/types/dashboard';
import { getAccounts, getAccountActivity } from '@/lib/api-client';
import { NotificationFeed } from '@/components/notifications/NotificationFeed';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { ExportButton } from '@/components/ui/ExportButton';
import { DASHBOARD_ROUTE_META } from '@/lib/dashboard-route-meta';

const FEED_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const FEED_PAGE_SIZE = 60;

function normalizeToken(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildActivityKey(entry: ActivityEntry): string {
  const profile = normalizeToken(entry.targetProfileUrl);
  const name = normalizeToken(entry.targetName);
  const message = normalizeToken(entry.message);
  const target = profile || name;
  return `${entry.type}|${entry.accountId}|${target}|${message}`;
}

function dedupeActivityEntries(entries: ActivityEntry[]): ActivityEntry[] {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  const latestByKey = new Map<string, number>();
  const deduped: ActivityEntry[] = [];

  for (const entry of sorted) {
    const key = buildActivityKey(entry);
    const previousTs = latestByKey.get(key);
    if (typeof previousTs === 'number' && previousTs - entry.timestamp <= FEED_DEDUPE_WINDOW_MS) {
      continue;
    }
    latestByKey.set(key, entry.timestamp);
    deduped.push(entry);
  }

  return deduped;
}

export default function NotificationsPage() {
  const routeMeta = DASHBOARD_ROUTE_META.notifications;
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab] = useState<ActivityTab>('all');
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [fetchLimit, setFetchLimit] = useState(FEED_PAGE_SIZE);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (requestedLimit?: number) => {
    try {
      const effectiveLimit = requestedLimit ?? FEED_PAGE_SIZE;
      const { accounts: accs } = await getAccounts();
      setAccounts(accs);

      const settledLogs = await Promise.allSettled(
        accs.map((account) => getAccountActivity(account.id, 0, effectiveLimit))
      );

      const fulfilledLogs = settledLogs.filter(
        (item): item is PromiseFulfilledResult<{ entries: ActivityEntry[]; total: number }> =>
          item.status === 'fulfilled'
      );

      const merged = fulfilledLogs
        .flatMap((item) => item.value.entries)
        .sort((a, b) => b.timestamp - a.timestamp);

      const optimized = dedupeActivityEntries(merged).slice(0, effectiveLimit);
      const hasMore = fulfilledLogs.some((item) => item.value.total > item.value.entries.length);

      setEntries(optimized);
      setFetchLimit(effectiveLimit);
      setCanLoadMore(hasMore);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(fetchLimit), 60_000);
    return () => clearInterval(interval);
  }, [fetchLimit, load]);

  const handleLoadMore = useCallback(async () => {
    const nextLimit = fetchLimit + FEED_PAGE_SIZE;
    setIsLoadingMore(true);

    try {
      await load(nextLimit);
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchLimit, load]);

  const filtered = tab === 'all' ? entries : entries.filter((entry) => entry.type === tab);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void load(fetchLimit)} />;
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-base)' }}>
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {routeMeta.pageTitle}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {routeMeta.description}
          </p>
        </div>
        <ExportButton
          type="activity"
          label="Export Activity"
          size="sm"
        />
      </div>

      <div className="flex-1 overflow-hidden">
        <NotificationFeed
          entries={filtered}
          accounts={accounts}
          activeTab={tab}
          onTabChange={setTab}
          totalUnread={entries.length}
          title="Entries"
          canLoadMore={canLoadMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={() => void handleLoadMore()}
        />
      </div>
    </div>
  );
}
