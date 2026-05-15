'use client';

import { AlertTriangle } from 'lucide-react';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: 'rgba(239,68,68,0.1)' }}
      >
        <AlertTriangle size={20} style={{ color: '#dc2626' }} />
      </div>
      <p
        className="max-w-xs text-center text-sm"
        style={{ color: 'var(--text-muted)' }}
      >
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="button-primary rounded-lg px-4 py-2 text-sm font-medium"
          style={{ cursor: 'pointer' }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
