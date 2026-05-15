interface AccountBadgeProps {
  name: string;
  onClick?: () => void;
  variant?: 'default' | 'subtle';
}

export function AccountBadge({ name, onClick, variant = 'default' }: AccountBadgeProps) {
  const interactive = typeof onClick === 'function';
  const subtle = variant === 'subtle';

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center rounded-full font-medium transition-colors ${
        subtle ? 'px-2 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-[11px]'
      } ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
      style={{
        background: subtle ? 'var(--inbox-template-bg, rgba(37, 99, 235, 0.08))' : 'var(--badge-purple)',
        color: subtle ? 'var(--text-muted-new, var(--badge-text))' : 'var(--badge-text)',
        border: subtle ? '1px solid rgba(148, 163, 184, 0.24)' : 'none',
      }}
    >
      {name}
    </span>
  );
}
