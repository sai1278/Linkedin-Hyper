'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.error(error);
    }
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="bg-[#0F172A]">
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="bg-[#1E293B] border border-[#334155] rounded-2xl p-8 max-w-md w-full text-center">
            <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-100 mb-2">Something went broadly wrong</h2>
            <p className="text-slate-400 mb-6 text-sm">
              {process.env.NODE_ENV === 'development'
                ? error.message
                : 'A critical error occurred causing the application to crash.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-sky-500 hover:bg-sky-600 text-white font-medium py-2.5 rounded-lg transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
