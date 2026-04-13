'use client';

import { memo } from 'react';
import type { Conversation, Account } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { UnreadBadge } from '@/components/ui/UnreadBadge';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { formatRelativeTime } from '@/lib/time-utils';

interface ConversationListProps {
  conversations: Conversation[];
  accounts: Account[];
  selected: Conversation | null;
  filter: string;
  onFilterChange: (f: string) => void;
  onSelect: (conv: Conversation) => void;
}

// React.memo prevents re-renders when props have not changed.
export const ConversationList = memo(function ConversationList({
  conversations,
  accounts,
  selected,
  filter,
  onFilterChange,
  onSelect,
}: ConversationListProps) {
  const totalUnread = conversations.reduce((sum, conversation) => sum + (conversation.unreadCount ?? 0), 0);

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: '380px',
        borderRight: '1px solid var(--border-color, var(--border))',
        flexShrink: 0,
        backgroundColor: 'var(--bg-secondary, var(--bg-panel))',
      }}
    >
      <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border-color, var(--border))' }}>
        <h2
          className="text-lg font-display font-semibold"
          style={{ color: 'var(--text-primary-new, var(--text-primary))' }}
        >
          Messages
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
          {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
        </p>
      </div>

      {accounts.length > 0 && (
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: 'var(--border-color, var(--border))' }}
        >
          <div className="flex gap-2 flex-wrap">
            {['all', ...accounts.map((a) => a.id)].map((accountId) => {
              const isActive = filter === accountId;
              return (
                <button
                  key={accountId}
                  onClick={() => onFilterChange(accountId)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={{
                    backgroundColor: isActive ? 'var(--accent)' : 'var(--bg-card)',
                    color: isActive ? '#ffffff' : 'var(--text-secondary, var(--text-muted))',
                    border: '1px solid',
                    borderColor: isActive ? 'var(--accent)' : 'var(--border-color, var(--border))',
                    boxShadow: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {accountId === 'all' ? 'All' : accountId}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        className="px-5 py-3 flex items-center justify-between"
        style={{
          borderBottom: '1px solid var(--border-color, var(--border))',
          background: 'var(--bg-hover)',
        }}
      >
        <span className="text-xs font-semibold tracking-[0.08em]" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
          RECENT
        </span>
        {totalUnread > 0 && <UnreadBadge count={totalUnread} color="blue" />}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: 'var(--color-gray-100)' }}
            >
              <svg
                className="w-8 h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{ color: 'var(--color-gray-400)' }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
              No recent messages
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
              Messages from the last hour will appear here
            </p>
          </div>
        ) : (
          conversations.map((conversation, index) => {
            const isSelected = conversation.conversationId === selected?.conversationId;
            const timeString = formatRelativeTime(conversation.lastMessage.sentAt);
            const hasUnread = conversation.unreadCount > 0;

            return (
              <button
                key={conversation.conversationId}
                onClick={() => onSelect(conversation)}
                className="w-full text-left flex items-start gap-3 p-3 mb-2 rounded-xl cursor-pointer transition-all hover:translate-y-[-1px]"
                style={{
                  backgroundColor: isSelected ? 'var(--bg-hover)' : 'var(--bg-card)',
                  border: isSelected
                    ? '1px solid var(--accent)'
                    : '1px solid var(--border-color)',
                  boxShadow: 'none',
                  animation: 'fadeIn 260ms ease both',
                  animationDelay: `${Math.min(index * 28, 220)}ms`,
                }}
              >
                <div className="relative flex-shrink-0">
                  <Avatar name={conversation.participant.name} size="md" />
                  {hasUnread && (
                    <div
                      className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2"
                      style={{
                        backgroundColor: 'var(--unread-dot)',
                        borderColor: 'var(--bg-secondary, white)',
                        boxShadow: 'none',
                      }}
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className={`text-sm truncate ${hasUnread ? 'font-semibold' : 'font-medium'}`}
                      style={{ color: 'var(--text-primary-new, var(--text-primary))' }}
                    >
                      {conversation.participant.name}
                    </span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
                      {timeString}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`text-xs truncate ${hasUnread ? 'font-medium' : ''}`}
                      style={{
                        color: hasUnread
                          ? 'var(--text-secondary, var(--text-primary))'
                          : 'var(--text-muted-new, var(--text-muted))',
                      }}
                    >
                      {conversation.lastMessage.sentByMe ? 'You: ' : ''}
                      {conversation.lastMessage.text}
                    </p>
                    {hasUnread && <UnreadBadge count={conversation.unreadCount} color="blue" />}
                  </div>

                  <div className="mt-2">
                    <AccountBadge name={conversation.accountId} />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});
