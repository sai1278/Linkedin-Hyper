// FILE: app/(dashboard)/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { AccountStatusRow } from '@/components/dashboard/AccountStatusRow';
import { RecentActivity } from '@/components/dashboard/RecentActivity';
import { Loader2 } from 'lucide-react';
import type { Account, ActivityEntry } from '@/types/dashboard';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalMessages: 0,
    totalConnections: 0,
    activeAccounts: 0,
    totalActivity: 0,
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch accounts
      const accountsRes = await fetch('/api/accounts');
      const accountsData = await accountsRes.json();
      const accountsList = accountsData.accounts || [];
      setAccounts(accountsList);

      // Fetch overall stats
      const statsRes = await fetch('/api/stats/all/summary');
      const statsData = await statsRes.json();
      
      setStats({
        totalMessages: statsData.totalMessages || 0,
        totalConnections: statsData.totalConnections || 0,
        activeAccounts: accountsList.filter((a: Account) => a.isActive).length,
        totalActivity: (statsData.totalMessages || 0) + (statsData.totalConnections || 0),
      });

      // Fetch recent activities from all accounts
      const activitiesPromises = accountsList.map((account: Account) =>
        fetch(`/api/stats/${account.id}/activity?limit=5`).then(res => res.json())
      );
      
      const activitiesResults = await Promise.allSettled(activitiesPromises);
      const allActivities: ActivityEntry[] = [];
      
      activitiesResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.entries) {
          allActivities.push(...result.value.entries);
        }
      });

      // Sort by timestamp and take top 10
      allActivities.sort((a, b) => b.timestamp - a.timestamp);
      setActivities(allActivities.slice(0, 10));

    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin mx-auto mb-2" style={{ color: 'var(--accent)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 md:px-8 max-w-7xl mx-auto space-y-8">
      <div
        className="rounded-2xl border p-6 md:p-7"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-secondary)',
        }}
      >
        <h1 className="text-3xl font-bold font-display" style={{ color: 'var(--text-primary)' }}>
          Dashboard
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Overview of your LinkedIn automation activity
        </p>
      </div>
      <StatsGrid stats={stats} />
      <AccountStatusRow accounts={accounts} />
      <RecentActivity activities={activities} />
    </div>
  );
}
