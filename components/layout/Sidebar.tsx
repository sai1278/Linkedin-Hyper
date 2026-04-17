'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail, Users, Bell, UserCircle, HeartPulse } from 'lucide-react';
import { getUnifiedConnections, getUnifiedInbox, getAllAccountsSummary, getHealthSummary } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { DASHBOARD_NAV_ITEMS } from '@/lib/dashboard-route-meta';

interface NavCounts {
  inbox: number;
  connections: number;
  notifications: number;
  status: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [counts, setCounts] = useState<NavCounts>({
    inbox: 0,
    connections: 0,
    notifications: 0,
    status: 0,
  });

  async function fetchCounts() {
    try {
      const [inboxResult, connectionsResult, summaryResult, healthResult] = await Promise.allSettled([
        getUnifiedInbox(),
        getUnifiedConnections(500),
        getAllAccountsSummary(),
        getHealthSummary(),
      ]);

      const inboxUnread =
        inboxResult.status === 'fulfilled'
          ? inboxResult.value.conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)
          : 0;

      const connections =
        connectionsResult.status === 'fulfilled'
          ? connectionsResult.value.connections.length
          : 0;

      const notifications =
        summaryResult.status === 'fulfilled'
          ? summaryResult.value.totalActivity
          : 0;

      const status =
        healthResult.status === 'fulfilled'
          ? healthResult.value.totals.criticalAlerts + healthResult.value.totals.warningAlerts
          : 0;

      setCounts({ inbox: inboxUnread, connections, notifications, status });
    } catch {
      // silently fail - badges stay at 0
    }
  }

  useEffect(() => {
    const runFetch = () => {
      void fetchCounts();
    };

    const timeoutId = setTimeout(runFetch, 0);
    const intervalId = setInterval(runFetch, 60_000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, []);

  const displayName = user?.name?.trim() || 'Dashboard Admin';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'DA';

  const navItems = DASHBOARD_NAV_ITEMS.map((item) => ({
    href: item.href,
    label: item.navLabel,
    icon:
      item.href === '/inbox'
        ? Mail
        : item.href === '/connections'
          ? Users
          : item.href === '/notifications'
            ? Bell
            : item.href === '/accounts'
              ? UserCircle
              : HeartPulse,
    count:
      item.href === '/inbox'
        ? counts.inbox
        : item.href === '/connections'
          ? counts.connections
          : item.href === '/notifications'
            ? counts.notifications
            : item.href === '/status'
              ? counts.status
            : 0,
    countColor:
      item.href === '/connections'
        ? 'bg-purple-600'
        : item.href === '/accounts'
          ? 'bg-blue-600'
          : 'bg-red-600',
  }));

  return (
    <nav
      className="flex w-14 min-h-screen flex-shrink-0 flex-col items-center gap-2 border-r py-4 max-[900px]:min-h-0 max-[900px]:w-full max-[900px]:flex-row max-[900px]:items-center max-[900px]:justify-between max-[900px]:gap-3 max-[900px]:border-b max-[900px]:border-r-0 max-[900px]:px-4 max-[900px]:py-3"
      style={{
        background: 'var(--bg-panel)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="mb-4 flex-shrink-0 max-[900px]:mb-0">
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center font-bold text-white text-lg select-none"
          style={{ background: '#0a66c2' }}
        >
          in
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 max-[900px]:min-w-0 max-[900px]:flex-row max-[900px]:items-center max-[900px]:justify-start max-[900px]:gap-2 max-[900px]:overflow-x-auto">
        {navItems.map(({ href, icon: Icon, label, count, countColor }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              className="relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors max-[900px]:h-auto max-[900px]:w-auto max-[900px]:gap-2 max-[900px]:px-3 max-[900px]:py-2"
              style={{
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                background: isActive ? 'rgba(108,99,255,0.12)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <Icon size={20} />
              <span className="hidden text-sm font-medium max-[900px]:inline">{label}</span>
              {count > 0 && (
                <span
                  className={`absolute -top-1 -right-1 ${countColor} text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5`}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto mb-2 flex flex-col items-center gap-1 max-[900px]:mt-0 max-[900px]:mb-0">
        <div className="relative">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)' }}
            title={displayName}
            aria-label={displayName}
          >
            {initials}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-[var(--bg-panel)]" aria-hidden="true" />
        </div>
        <span className="hidden text-[11px] max-[900px]:inline" style={{ color: 'var(--text-muted)' }}>
          Signed in
        </span>
      </div>
    </nav>
  );
}
