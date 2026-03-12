'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Optionally log the error to an error reporting service
    console.error('App Error:', error);
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-xl shadow-md text-center">
        <div>
          <h2 className="mt-6 text-3xl font-extrabold text-[#0B1F3B]">Something went wrong!</h2>
          <p className="mt-2 text-sm text-gray-600">
            {isDev ? error.message : 'An unexpected error occurred while loading this page.'}
          </p>
        </div>
        <div className="mt-8 space-y-4 flex flex-col items-center">
          <button
            onClick={() => reset()}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-[#49648C] hover:bg-[#3A5070] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#49648C] transition-colors"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="w-full flex justify-center py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#49648C] transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
