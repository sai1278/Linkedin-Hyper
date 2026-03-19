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
      color: '#6c63ff',
      bgColor: 'rgba(108, 99, 255, 0.1)',
    },
    {
      label: 'Connections Sent',
      value: stats.totalConnections,
      icon: Users,
      color: '#22c55e',
      bgColor: 'rgba(34, 197, 94, 0.1)',
    },
    {
      label: 'Active Accounts',
      value: stats.activeAccounts,
      icon: TrendingUp,
      color: '#f59e0b',
      bgColor: 'rgba(245, 158, 11, 0.1)',
    },
    {
      label: 'Total Activity',
      value: stats.totalActivity,
      icon: Activity,
      color: '#3b82f6',
      bgColor: 'rgba(59, 130, 246, 0.1)',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border p-6 transition-all hover:border-opacity-50"
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
          </div>
        </div>
      ))}
    </div>
  );
}
