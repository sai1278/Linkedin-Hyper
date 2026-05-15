// FILE: components/ui/SkeletonLoader.tsx
// Loading skeleton components for better UX

export function ConversationSkeleton() {
  return (
    <div className="flex gap-3 p-4 border-b animate-pulse" style={{ borderColor: 'var(--border)' }}>
      {/* Avatar */}
      <div 
        className="w-12 h-12 rounded-full flex-shrink-0" 
        style={{ backgroundColor: 'var(--color-gray-200)' }}
      />
      
      {/* Content */}
      <div className="flex-1 space-y-2">
        {/* Name */}
        <div 
          className="h-4 rounded" 
          style={{ 
            backgroundColor: 'var(--color-gray-200)', 
            width: '40%' 
          }}
        />
        {/* Message preview */}
        <div 
          className="h-3 rounded" 
          style={{ 
            backgroundColor: 'var(--color-gray-200)', 
            width: '80%' 
          }}
        />
      </div>
      
      {/* Timestamp */}
      <div 
        className="h-3 rounded w-16" 
        style={{ backgroundColor: 'var(--color-gray-200)' }}
      />
    </div>
  );
}

export function ConversationListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <ConversationSkeleton key={i} />
      ))}
    </>
  );
}

export function MessageSkeleton({ isSentByMe = false }: { isSentByMe?: boolean }) {
  return (
    <div 
      className={`flex gap-3 mb-4 animate-pulse ${isSentByMe ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar (only for received messages) */}
      {!isSentByMe && (
        <div 
          className="w-8 h-8 rounded-full flex-shrink-0" 
          style={{ backgroundColor: 'var(--color-gray-200)' }}
        />
      )}
      
      {/* Message bubble */}
      <div 
        className="rounded-xl px-4 py-3" 
        style={{ 
          backgroundColor: 'var(--color-gray-200)',
          maxWidth: '70%',
          minWidth: '200px',
          height: '60px',
        }}
      />
    </div>
  );
}

export function MessageThreadSkeleton() {
  return (
    <div className="p-4 space-y-4">
      <MessageSkeleton isSentByMe={false} />
      <MessageSkeleton isSentByMe={true} />
      <MessageSkeleton isSentByMe={false} />
      <MessageSkeleton isSentByMe={true} />
      <MessageSkeleton isSentByMe={false} />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div 
      className="rounded-lg p-6 animate-pulse" 
      style={{ backgroundColor: 'var(--bg-card)' }}
    >
      <div 
        className="h-6 rounded mb-4" 
        style={{ 
          backgroundColor: 'var(--color-gray-200)', 
          width: '60%' 
        }}
      />
      <div 
        className="h-4 rounded mb-2" 
        style={{ 
          backgroundColor: 'var(--color-gray-200)', 
          width: '40%' 
        }}
      />
      <div 
        className="h-4 rounded" 
        style={{ 
          backgroundColor: 'var(--color-gray-200)', 
          width: '80%' 
        }}
      />
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div 
      className="rounded-lg p-6 animate-pulse" 
      style={{ backgroundColor: 'var(--bg-card)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div 
          className="h-4 rounded" 
          style={{ 
            backgroundColor: 'var(--color-gray-200)', 
            width: '40%' 
          }}
        />
        <div 
          className="w-10 h-10 rounded-lg" 
          style={{ backgroundColor: 'var(--color-gray-200)' }}
        />
      </div>
      <div 
        className="h-8 rounded" 
        style={{ 
          backgroundColor: 'var(--color-gray-200)', 
          width: '60%' 
        }}
      />
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <tr className="animate-pulse">
      <td className="p-3">
        <div 
          className="h-4 rounded" 
          style={{ 
            backgroundColor: 'var(--color-gray-200)', 
            width: '80%' 
          }}
        />
      </td>
      <td className="p-3">
        <div 
          className="h-4 rounded" 
          style={{ 
            backgroundColor: 'var(--color-gray-200)', 
            width: '60%' 
          }}
        />
      </td>
      <td className="p-3">
        <div 
          className="h-4 rounded" 
          style={{ 
            backgroundColor: 'var(--color-gray-200)', 
            width: '40%' 
          }}
        />
      </td>
    </tr>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <table className="w-full">
      <tbody>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRowSkeleton key={i} />
        ))}
      </tbody>
    </table>
  );
}

export function DashboardOverviewSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="h-4 w-40 animate-pulse rounded" style={{ backgroundColor: 'var(--color-gray-200)' }} />
          <div className="h-10 w-56 animate-pulse rounded" style={{ backgroundColor: 'var(--color-gray-200)' }} />
          <div className="h-4 w-80 animate-pulse rounded" style={{ backgroundColor: 'var(--color-gray-200)' }} />
        </div>
        <div className="w-full max-w-sm rounded-xl border p-4" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="space-y-2">
            <div className="h-4 w-40 animate-pulse rounded" style={{ backgroundColor: 'var(--color-gray-200)' }} />
            <div className="h-3 w-full animate-pulse rounded" style={{ backgroundColor: 'var(--color-gray-200)' }} />
            <div className="h-3 w-4/5 animate-pulse rounded" style={{ backgroundColor: 'var(--color-gray-200)' }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr,1fr]">
        <CardSkeleton />
        <CardSkeleton />
      </div>

      <CardSkeleton />
    </div>
  );
}
