import { formatCount } from '@/lib/utils';

interface UnreadBadgeProps {
  count: number;
  color?: 'red' | 'blue';
}

export function UnreadBadge({ count, color = 'red' }: UnreadBadgeProps) {
  const label = formatCount(count);
  if (!label) return null;   // returns null at count === 0

  return (
    <span
      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold text-white px-1 flex-shrink-0 ${
        color === 'blue' ? 'bg-blue-600' : 'bg-red-600'
      }`}
    >
      {label}
    </span>
  );
}
