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

      // Inbox unread — from unified inbox; ignore failures (slow scrape)
      let inboxUnread = 0;
      try {
        const { conversations } = await getUnifiedInbox();
        inboxUnread = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
      } catch {
        // intentionally swallowed
      }

      // Connections + notifications from all account activity logs
      let connections  = 0;
      let notifications = 0;
      const activityResults = await Promise.allSettled(
        accounts.map((a) => getAccountActivity(a.id, 0, 200))
      );
      for (const r of activityResults) {
        if (r.status === 'fulfilled') {
          connections   += r.value.entries.filter((e) => e.type === 'connectionSent').length;
          notifications += r.value.entries.length;
        }
      }

      setCounts({ inbox: inboxUnread, connections, notifications });
    } catch {
      // silently fail — badges stay at 0
    }
  }

  useEffect(() => {
    void fetchCounts();
    const id = setInterval(() => void fetchCounts(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navItems = [
    {
      href:       '/inbox',
      icon:       Mail,
      label:      'Inbox',
      count:      counts.inbox,
      countColor: 'bg-red-600',
    },
    {
      href:       '/connections',
      icon:       Users,
      label:      'Network',
      count:      counts.connections,
      countColor: 'bg-purple-600',
    },
    {
      href:       '/notifications',
      icon:       Bell,
      label:      'Activity',
      count:      counts.notifications,
      countColor: 'bg-red-600',
    },
    {
      href:       '/accounts',
      icon:       UserCircle,
      label:      'Accounts',
      count:      0,
      countColor: 'bg-blue-600',
    },
  ];

  return (
    <nav
      className="flex flex-col items-center py-4 gap-2 flex-shrink-0"
      style={{
        width: '56px',
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        minHeight: '100vh',
      }}
    >
      {/* LinkedIn brand logo — LinkedIn blue, NOT the purple avatar gradient */}
      <div className="mb-4 flex-shrink-0">
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center font-bold text-white text-lg select-none"
          style={{ background: '#0a66c2' }}
        >
          in
        </div>
      </div>

      {/* Nav links */}
      <div className="flex flex-col gap-1 flex-1">
        {navItems.map(({ href, icon: Icon, label, count, countColor }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className="relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors"
              style={{
                color:       isActive ? 'var(--accent)'          : 'var(--text-muted)',
                background:  isActive ? 'rgba(108,99,255,0.12)'  : 'transparent',
                borderLeft:  isActive ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <Icon size={20} />
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

      {/* Bottom: purple "LI" avatar with green online dot */}
      <div className="mt-auto mb-2 flex flex-col items-center gap-1">
        <div className="relative">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)' }}
          >
            LI
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-[var(--bg-panel)]" />
        </div>
      </div>
    </nav>
  );
}
