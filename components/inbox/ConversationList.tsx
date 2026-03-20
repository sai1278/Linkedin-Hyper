'use client';

import { memo } from 'react';
import type { Conversation, Account } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { UnreadBadge } from '@/components/ui/UnreadBadge';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { timeAgo } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/time-utils';

interface ConversationListProps {
  conversations: Conversation[];
  accounts: Account[];
  selected: Conversation | null;
  filter: string;
  onFilterChange: (f: string) => void;
  onSelect: (conv: Conversation) => void;
}

// F3 — React.memo prevents re-renders when conversations/accounts/selected haven't changed.
export const ConversationList = memo(function ConversationList({
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
      style={{ 
        width: '360px', 
        borderRight: '1px solid var(--border-color, var(--border))', 
        flexShrink: 0,
        backgroundColor: 'var(--bg-secondary, var(--bg-panel))',
      }}
    >
      {/* Header */}
      <div className="px-4 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border-color, var(--border))' }}>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
          Messages
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
          {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
        </p>
      </div>

      {/* Account filter pills */}
      {accounts.length > 0 && (
        <div className="flex gap-2 px-4 py-3 flex-wrap border-b" style={{ borderColor: 'var(--border-color, var(--border))' }}>
          {['all', ...accounts.map((a) => a.id)].map((acc) => {
            const isActive = filter === acc;
            return (
              <button
                key={acc}
                onClick={() => onFilterChange(acc)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  backgroundColor: isActive 
                    ? 'var(--color-primary-500, var(--accent))' 
                    : 'var(--color-gray-100, var(--bg-card))',
                  color: isActive 
                    ? '#ffffff' 
                    : 'var(--text-secondary, var(--text-muted))',
                  border: '1px solid',
                  borderColor: isActive 
                    ? 'var(--color-primary-600, var(--accent))' 
                    : 'var(--border-color, var(--border))',
                  cursor: 'pointer',
                }}
              >
                {acc === 'all' ? `All (${conversations.length})` : acc}
              </button>
            );
          })}
        </div>
      )}

      {/* Section label */}
      <div className="px-4 py-3 flex items-center justify-between bg-opacity-50" style={{ backgroundColor: 'var(--bg-primary, transparent)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
          Recent
        </span>
        {totalUnread > 0 && <UnreadBadge count={totalUnread} />}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
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
          conversations.map((conv) => {
            const isSelected = conv.conversationId === selected?.conversationId;
            const timeStr = formatRelativeTime(conv.lastMessage.sentAt);
            const hasUnread = conv.unreadCount > 0;
            
            return (
              <div
                key={conv.conversationId}
                onClick={() => onSelect(conv)}
                className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-all"
                style={{
                  backgroundColor: isSelected 
                    ? 'var(--color-primary-50, var(--bg-hover))' 
                    : 'transparent',
                  borderBottom: '1px solid var(--border-color, var(--border))',
                  borderLeft: isSelected 
                    ? '3px solid var(--color-primary-500, var(--accent))' 
                    : '3px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'var(--color-gray-50, rgba(34,34,46,0.3))';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div className="relative flex-shrink-0">
                  <Avatar name={conv.participant.name} size="md" />
                  {hasUnread && (
                    <div 
                      className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2"
                      style={{ 
                        backgroundColor: 'var(--color-primary-500, #3b82f6)',
                        borderColor: 'var(--bg-secondary, white)',
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
                      {conv.participant.name}
                    </span>
                    <span 
                      className="text-xs flex-shrink-0" 
                      style={{ color: 'var(--text-muted-new, var(--text-muted))' }}
                    >
                      {timeStr}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between gap-2">
                    <p 
                      className={`text-xs truncate ${hasUnread ? 'font-medium' : ''}`}
                      style={{ 
                        color: hasUnread 
                          ? 'var(--text-secondary, var(--text-primary))' 
                          : 'var(--text-muted-new, var(--text-muted))' 
                      }}
                    >
                      {conv.lastMessage.sentByMe ? 'You: ' : ''}
                      {conv.lastMessage.text}
                    </p>
                    {hasUnread && <UnreadBadge count={conv.unreadCount} />}
                  </div>
                  
                  <div className="mt-1">
                    <AccountBadge name={conv.accountId} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
