import type { NotificationTab } from '@/types/dashboard';

interface TabFilterProps {
  activeTab: NotificationTab;
  onChange: (tab: NotificationTab) => void;
  counts: Partial<Record<NotificationTab, number>>;
}

const TABS: { id: NotificationTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'messages', label: 'Messages' },
  { id: 'connections', label: 'Connections' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'account', label: 'Account' },
];

export function TabFilter({ activeTab, onChange, counts }: TabFilterProps) {
  return (
    <div className="flex gap-1 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
      {TABS.map(({ id, label }) => {
        const isActive = activeTab === id;
        const count = counts[id];
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className="relative px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
            style={{
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-1px',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            {label}
            {count !== undefined && count > 0 && (
              <span
                className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--badge-purple)', color: 'var(--badge-text)' }}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
