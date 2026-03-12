import { timeAgo } from '@/lib/utils';

interface TimeAgoProps {
  timestamp: string;
  className?: string;
}

export function TimeAgo({ timestamp, className = '' }: TimeAgoProps) {
  return (
    <span className={`text-xs tabular-nums ${className}`} style={{ color: 'var(--text-muted)' }}>
      {timeAgo(timestamp)}
    </span>
  );
}
