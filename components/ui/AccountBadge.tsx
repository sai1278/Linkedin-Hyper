interface AccountBadgeProps {
  name: string;
  onClick?: () => void;
}

export function AccountBadge({ name, onClick }: AccountBadgeProps) {
  return (
    <span
      onClick={onClick}
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors"
      style={{
        background: 'var(--badge-purple)',
        color: 'var(--badge-text)',
      }}
    >
      {name}
    </span>
  );
}
