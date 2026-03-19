'use client';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
        style={{ background: 'rgba(239,68,68,0.1)' }}
      >
        ⚠
      </div>
      <p
        className="text-sm text-center max-w-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              'var(--accent-hover)')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              'var(--accent)')
          }
        >
          Retry
        </button>
      )}
    </div>
  );
}
