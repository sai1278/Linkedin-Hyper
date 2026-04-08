'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ActivityEntry, Account, ActivityTab } from '@/types/dashboard';
import { getAccounts, getAccountActivity } from '@/lib/api-client';
import { NotificationFeed } from '@/components/notifications/NotificationFeed';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { ExportButton } from '@/components/ui/ExportButton';

export default function NotificationsPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab] = useState<ActivityTab>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { accounts: accs } = await getAccounts();
      setAccounts(accs);

      // Partial failures should not crash the page.
      const settledLogs = await Promise.allSettled(
        accs.map((a) => getAccountActivity(a.id, 0, 100).then((r) => r.entries))
      );

      const merged = settledLogs
        .filter((result): result is PromiseFulfilledResult<ActivityEntry[]> => result.status === 'fulfilled')
        .flatMap((result) => result.value)
        .sort((a, b) => b.timestamp - a.timestamp);

      setEntries(merged);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load();
    }, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const filtered = tab === 'all' ? entries : entries.filter((e) => e.type === tab);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-base)' }}>
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--border-color, var(--border))' }}
      >
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Activity
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>
        <ExportButton type="activity" label="Export Activity" size="sm" />
      </div>

      <div className="flex-1 overflow-hidden">
        <NotificationFeed
          entries={filtered}
          accounts={accounts}
          activeTab={tab}
          onTabChange={setTab}
          totalUnread={entries.length}
        />
      </div>
    </div>
  );
}