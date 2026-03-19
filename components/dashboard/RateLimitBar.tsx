// FILE: components/dashboard/RateLimitBar.tsx
interface RateLimitBarProps {
  label: string;
  current: number;
  limit: number;
  resetsAt?: number;
}

export function RateLimitBar({ label, current, limit, resetsAt }: RateLimitBarProps) {
  const percentage = Math.min((current / limit) * 100, 100);
  
  const getColor = () => {
    if (percentage < 50) return '#22c55e';
    if (percentage < 80) return '#f59e0b';
    return '#ef4444';
  };

  const formatResetTime = () => {
    if (!resetsAt) return '';
    const now = Date.now();
    const diffMs = resetsAt - now;
    if (diffMs <= 0) return 'Reset now';
    
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    
    if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
    return `Resets in ${minutes}m`;
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--text-primary)' }} className="font-medium">
            {current}/{limit}
          </span>
          {resetsAt && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatResetTime()}
            </span>
          )}
        </div>
      </div>
      <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-elevated)' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${percentage}%`,
            background: getColor(),
          }}
        />
      </div>
    </div>
  );
}
