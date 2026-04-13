'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail, Users, Bell, UserCircle } from 'lucide-react';
import { getAccounts, getUnifiedInbox, getAccountActivity } from '@/lib/api-client';

interface NavCounts {
  inbox: number;
  connections: number;
  notifications: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<NavCounts>({
    inbox: 0,
    connections: 0,
    notifications: 0,
  });

  async function fetchCounts() {
    try {
      const { accounts } = await getAccounts();

      let inboxUnread = 0;
      try {
        const { conversations } = await getUnifiedInbox();
        inboxUnread = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
      } catch {
        // intentionally swallowed
      }

      let connections = 0;
      let notifications = 0;
      const activityResults = await Promise.allSettled(
        accounts.map((a) => getAccountActivity(a.id, 0, 200))
      );
      for (const result of activityResults) {
        if (result.status === 'fulfilled') {
          connections += result.value.entries.filter((e) => e.type === 'connectionSent').length;
          notifications += result.value.entries.length;
        }
      }

      setCounts({ inbox: inboxUnread, connections, notifications });
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

  const navItems = [
    {
      href: '/inbox',
      icon: Mail,
      label: 'Inbox',
      count: counts.inbox,
      badgeBg: 'var(--accent)',
    },
    {
      href: '/connections',
      icon: Users,
      label: 'Network',
      count: counts.connections,
      badgeBg: 'var(--accent)',
    },
    {
      href: '/notifications',
      icon: Bell,
      label: 'Activity',
      count: counts.notifications,
      badgeBg: 'var(--accent)',
    },
    {
      href: '/accounts',
      icon: UserCircle,
      label: 'Accounts',
      count: 0,
      badgeBg: 'var(--accent)',
    },
  ];

  return (
    <nav
      className="flex flex-col items-center py-4 gap-3 flex-shrink-0"
      style={{
        width: '72px',
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        minHeight: '100vh',
        boxShadow: 'none',
      }}
    >
      <div className="mb-4 flex-shrink-0 text-center">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-lg select-none mx-auto"
          style={{
            background: 'var(--accent)',
            boxShadow: 'none',
          }}
        >
          in
        </div>
        <p className="text-[10px] mt-2 tracking-[0.12em] font-semibold" style={{ color: 'var(--text-muted)' }}>
          HYPER
        </p>
      </div>

      <div className="flex flex-col gap-2 flex-1">
        {navItems.map(({ href, icon: Icon, label, count, badgeBg }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              className="relative flex items-center justify-center w-11 h-11 rounded-xl transition-all"
              style={{
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                background: isActive ? 'var(--bg-hover)' : 'transparent',
                border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
                boxShadow: 'none',
              }}
            >
              <Icon size={20} />
              {count > 0 && (
                <span
                  className="absolute -top-1 -right-1 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1"
                  style={{
                    background: badgeBg,
                    boxShadow: 'none',
                  }}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto mb-2 flex flex-col items-center gap-1">
        <div className="relative">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
            style={{ background: 'var(--accent)' }}
          >
            LI
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[var(--bg-panel)]" />
        </div>
      </div>
    </nav>
  );
}
