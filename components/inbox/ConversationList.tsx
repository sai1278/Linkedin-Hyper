'use client';

import type { Conversation, Account } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { UnreadBadge } from '@/components/ui/UnreadBadge';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { timeAgo } from '@/lib/utils';

interface ConversationListProps {
  conversations: Conversation[];
  accounts: Account[];
  selected: Conversation | null;
  filter: string;
  onFilterChange: (f: string) => void;
  onSelect: (conv: Conversation) => void;
}

export function ConversationList({
  conversations,
  accounts,
  selected,
  filter,
  onFilterChange,
  onSelect,
}: ConversationListProps) {
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);

  return (
    <div
      className="flex flex-col h-full"
      style={{ width: '300px', borderRight: '1px solid var(--border)', flexShrink: 0 }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Live Hook
        </p>
        <h2 className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
          LinkedIn Unified Inbox
        </h2>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs" style={{ color: '#22c55e' }}>
            Live — receiving messages
          </span>
        </div>
      </div>

      {/* Account filter pills */}
      <div className="flex gap-1 px-3 pb-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        {['all', ...accounts.map((a) => a.id)].map((acc) => {
          const isActive = filter === acc;
          return (
            <button
              key={acc}
              onClick={() => onFilterChange(acc)}
              className="px-2 py-1 rounded text-xs font-medium transition-colors"
              style={{
                background: isActive ? 'var(--accent)' : 'var(--bg-card)',
                color: isActive ? '#fff' : 'var(--text-muted)',
                border: '1px solid',
                borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                cursor: 'pointer',
              }}
            >
              {acc === 'all' ? 'All' : acc}
            </button>
          );
        })}
      </div>

      {/* Section label */}
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Conversations
        </span>
        {totalUnread > 0 && <UnreadBadge count={totalUnread} />}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No conversations</p>
          </div>
        ) : (
          conversations.map((conv) => {
            const isSelected = conv.conversationId === selected?.conversationId;
            return (
              <div
                key={conv.conversationId}
                onClick={() => onSelect(conv)}
                className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors"
                style={{
                  background: isSelected ? 'var(--bg-hover)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLDivElement).style.background = 'rgba(34,34,46,0.5)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                }}
              >
                <Avatar name={conv.participant.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {conv.participant.name}
                      </span>
                      <AccountBadge name={conv.accountId} />
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {timeAgo(conv.lastMessage.sentAt)}
                      </span>
                      {conv.unreadCount > 0 && <UnreadBadge count={conv.unreadCount} />}
                    </div>
                  </div>
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {conv.lastMessage.sentByMe ? 'You: ' : ''}{conv.lastMessage.text}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
