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
      className="flex items-center justify-between px-6 py-3"
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-panel)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
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

        <div className="flex items-center gap-2 text-sm min-w-0" style={{ color: 'var(--text-muted)' }}>
          <Link href="/" className="inline-flex items-center gap-1 transition-colors" style={{ color: 'var(--text-link)' }}>
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
        <span className="hidden md:block text-xs" style={{ color: 'var(--text-muted)' }}>
          {routeMeta.description}
        </span>
      )}
    </div>
  );
}
