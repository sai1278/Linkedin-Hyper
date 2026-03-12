'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ActivityEntry, Account, ActivityTab } from '@/types/dashboard';
import { getAccounts, getAccountActivity } from '@/lib/api-client';
import { NotificationFeed } from '@/components/notifications/NotificationFeed';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';

export default function NotificationsPage() {
  const [entries, setEntries]   = useState<ActivityEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab]           = useState<ActivityTab>('all');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { accounts: accs } = await getAccounts();
      setAccounts(accs);

      const logs = await Promise.all(
        accs.map((a) => getAccountActivity(a.id, 0, 100).then((r) => r.entries))
      );

      const merged = logs
        .flat()
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
    const interval = setInterval(() => void load(), 60_000);
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
    <div className="h-full" style={{ background: 'var(--bg-base)' }}>
      <NotificationFeed
        entries={filtered}
        accounts={accounts}
        activeTab={tab}
        onTabChange={setTab}
        totalUnread={entries.length}
      />
    </div>
  );
}
