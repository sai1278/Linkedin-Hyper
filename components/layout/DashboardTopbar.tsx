'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ChevronRight, Home } from 'lucide-react';
import { getDashboardRouteMeta } from '@/lib/dashboard-route-meta';

export function DashboardTopbar() {
  const pathname = usePathname();
  const routeMeta = getDashboardRouteMeta(pathname);
  const isDashboardHome = routeMeta.href === '/';

  return (
    <div
      className="flex flex-col gap-2 px-6 py-3 md:flex-row md:items-center md:justify-between"
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-panel)',
      }}
    >
      <div className="min-w-0">
        {!isDashboardHome && (
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium transition-colors"
            style={{ color: 'var(--text-link)' }}
          >
            <ArrowLeft size={14} />
            Back to Dashboard
          </Link>
        )}

        <div
          className={`flex flex-wrap items-center gap-2 text-sm ${isDashboardHome ? '' : 'mt-1'}`}
          style={{ color: 'var(--text-muted)' }}
        >
          <Link
            href="/"
            className="inline-flex items-center gap-1 transition-colors"
            style={{ color: 'var(--text-link)' }}
          >
            <Home size={14} />
            Dashboard
          </Link>
          {!isDashboardHome && (
            <>
              <ChevronRight size={14} />
              <span
                className="truncate font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {routeMeta.pageTitle}
              </span>
            </>
          )}
        </div>
      </div>

      {!isDashboardHome && (
        <span className="text-xs md:max-w-md md:text-right" style={{ color: 'var(--text-muted)' }}>
          {routeMeta.description}
        </span>
      )}
    </div>
  );
}
