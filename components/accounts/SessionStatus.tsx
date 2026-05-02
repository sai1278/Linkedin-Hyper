interface SessionStatusProps {
  label: string;
  color: string;
  detail: string;
}

export function SessionStatus({ label, color, detail }: SessionStatusProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-sm font-medium" style={{ color }}>
          {label}
        </span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {detail}
      </p>
    </div>
  );
}
