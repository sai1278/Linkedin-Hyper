// FILE: components/accounts/SessionStatus.tsx
interface SessionStatusProps {
  isActive: boolean;
  hasSession: boolean;
  lastSeen: string | null;
}

export function SessionStatus({ isActive, hasSession, lastSeen }: SessionStatusProps) {
  const getStatus = () => {
    if (isActive && hasSession) {
      return { label: 'Active', color: '#22c55e', icon: '✓' };
    }
    if (hasSession && !isActive) {
      return { label: 'Expired', color: '#ef4444', icon: '✕' };
    }
    return { label: 'No Session', color: '#f59e0b', icon: '⚠' };
  };

  const status = getStatus();

  return (
    <div className="flex items-center gap-2">
      <div
        className="w-2 h-2 rounded-full"
        style={{ background: status.color }}
      />
      <span className="text-sm font-medium" style={{ color: status.color }}>
        {status.icon} {status.label}
      </span>
      {lastSeen && (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          • Last seen {formatTimestamp(lastSeen)}
        </span>
      )}
    </div>
  );
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
