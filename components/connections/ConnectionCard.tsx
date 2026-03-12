import type { Connection } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { AccountBadge } from '@/components/ui/AccountBadge';

interface ConnectionCardProps {
  connection: Connection;
  onClick?: () => void;
}

export function ConnectionCard({ connection, onClick }: ConnectionCardProps) {
  const { fullName, initials, headline, accountId, connectedAt } = connection;

  return (
    <div
      onClick={onClick}
      className="flex flex-col items-center text-center p-4 rounded-xl gap-3 cursor-pointer transition-all"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)';
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          '0 4px 24px rgba(108,99,255,0.12)';
        (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(108,99,255,0.4)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
      }}
    >
      <Avatar initials={initials} size="lg" />
      <div className="w-full min-w-0">
        <p
          className="text-sm font-semibold truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {fullName}
        </p>
        <p
          className="text-xs mt-0.5 line-clamp-2 leading-relaxed"
          style={{ color: 'var(--text-muted)' }}
        >
          {headline}
        </p>
      </div>
      <div className="flex flex-col items-center gap-1 w-full">
        <AccountBadge name={accountId} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {connectedAt}
        </span>
      </div>
    </div>
  );
}
