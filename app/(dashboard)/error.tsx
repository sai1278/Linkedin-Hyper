'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard Error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-10">
      <div
        className="w-full max-w-lg rounded-2xl border p-8 text-center shadow-sm"
        style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
          Dashboard Error
        </p>
        <h2 className="mt-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          This section hit an unexpected error
        </h2>
        <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          We kept the failure inside the dashboard so the rest of the app is protected. Try reloading this section or go back to the dashboard home.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="button-primary rounded-lg px-4 py-2 text-sm font-medium"
          >
            Retry section
          </button>
          <Link
            href="/"
            className="button-secondary rounded-lg px-4 py-2 text-sm font-medium"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
