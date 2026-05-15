// FILE: components/dashboard/StatsGrid.tsx
'use client';

import { MessageSquare, Users, Activity, TrendingUp } from 'lucide-react';

interface StatsGridProps {
  stats: {
    totalMessages: number;
    totalConnections: number;
    activeAccounts: number;
    totalActivity: number;
  };
  summaryPeriodLabel: string;
  summaryFreshnessLabel: string;
}

export function StatsGrid({ stats, summaryPeriodLabel, summaryFreshnessLabel }: StatsGridProps) {
  const cards = [
    {
      label: 'Messages Sent',
      value: stats.totalMessages,
      icon: MessageSquare,
      color: '#6c63ff',
      bgColor: 'rgba(108, 99, 255, 0.1)',
      helper: 'All recorded sends',
    },
    {
      label: 'Connections Sent',
      value: stats.totalConnections,
      icon: Users,
      color: '#22c55e',
      bgColor: 'rgba(34, 197, 94, 0.1)',
      helper: 'All recorded connection requests',
    },
    {
      label: 'Active Accounts',
      value: stats.activeAccounts,
      icon: TrendingUp,
      color: '#f59e0b',
      bgColor: 'rgba(245, 158, 11, 0.1)',
      helper: 'Current session snapshot',
    },
    {
      label: 'Total Activity',
      value: stats.totalActivity,
      icon: Activity,
      color: '#3b82f6',
      bgColor: 'rgba(59, 130, 246, 0.1)',
      helper: 'Messages plus connections',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
            Snapshot
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {summaryPeriodLabel}
          </p>
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {summaryFreshnessLabel}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="interactive-card rounded-xl border p-6"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center"
                style={{ background: card.bgColor }}
              >
                <card.icon size={24} style={{ color: card.color }} />
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                {card.value.toLocaleString()}
              </div>
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {card.label}
              </div>
              <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {card.helper}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
