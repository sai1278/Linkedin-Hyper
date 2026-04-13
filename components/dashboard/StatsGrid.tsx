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
}

export function StatsGrid({ stats }: StatsGridProps) {
  const cards = [
    {
      label: 'Messages Sent',
      value: stats.totalMessages,
      icon: MessageSquare,
      color: 'var(--accent)',
      bgColor: 'var(--bg-hover)',
    },
    {
      label: 'Connections Sent',
      value: stats.totalConnections,
      icon: Users,
      color: '#22c55e',
      bgColor: 'rgba(34, 197, 94, 0.14)',
    },
    {
      label: 'Active Accounts',
      value: stats.activeAccounts,
      icon: TrendingUp,
      color: 'var(--accent)',
      bgColor: 'var(--bg-hover)',
    },
    {
      label: 'Total Activity',
      value: stats.totalActivity,
      icon: Activity,
      color: 'var(--accent)',
      bgColor: 'var(--bg-hover)',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-2xl border p-6 transition-all"
          style={{
            background: 'var(--bg-panel)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--shadow-sm)',
          }}
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
          </div>
        </div>
      ))}
    </div>
  );
}
