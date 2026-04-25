'use client';

import { memo, useRef } from 'react';
import { Search } from 'lucide-react';
import type { Conversation, Account } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { UnreadBadge } from '@/components/ui/UnreadBadge';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { formatRelativeTime } from '@/lib/time-utils';

interface ConversationListProps {
  conversations: Conversation[];
  accounts: Account[];
  accountLabels: Record<string, string>;
  selected: Conversation | null;
  filter: string;
  search: string;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  onFilterChange: (f: string) => void;
  onSearchChange: (value: string) => void;
  onLoadMore: () => void;
  onSelect: (conv: Conversation) => void;
}

export const ConversationList = memo(function ConversationList({
  conversations,
  accounts,
  accountLabels,
  selected,
  filter,
  search,
  canLoadMore,
  isLoadingMore,
  onFilterChange,
  onSearchChange,
  onLoadMore,
  onSelect,
}: ConversationListProps) {
  const totalUnread = conversations.reduce((sum, conversation) => sum + (conversation.unreadCount ?? 0), 0);
  const hasFilters = filter !== 'all' || search.trim().length > 0;
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusConversationAt = (index: number) => {
    itemRefs.current[index]?.focus();
  };

  const handleItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusConversationAt(Math.min(index + 1, conversations.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusConversationAt(Math.max(index - 1, 0));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusConversationAt(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusConversationAt(conversations.length - 1);
    }
  };

  return (
    <div
      className="flex h-full min-w-0 flex-1 flex-col"
      style={{
        borderRight: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary, var(--bg-panel))',
      }}
    >
      <div className="border-b px-4 pb-4 pt-5" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
          Inbox
        </h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
          {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
        </p>

        <div
          className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500"
          style={{
            backgroundColor: 'var(--bg-primary, var(--color-gray-50))',
            border: '1px solid var(--border)',
          }}
        >
          <Search size={14} style={{ color: 'var(--text-muted-new, var(--text-muted))' }} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search people or message text"
            aria-label="Search conversations"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: 'var(--text-primary-new, var(--text-primary))' }}
          />
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          {['all', ...accounts.map((account) => account.id)].map((accountId) => {
            const isActive = filter === accountId;
            return (
              <button
                type="button"
                key={accountId}
                onClick={() => onFilterChange(accountId)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                style={{
                  backgroundColor: isActive
                    ? 'var(--color-primary-500, var(--accent))'
                    : 'var(--color-gray-100, var(--bg-card))',
                  color: isActive ? '#ffffff' : 'var(--text-secondary, var(--text-muted))',
                  border: '1px solid',
                  borderColor: isActive
                    ? 'var(--color-primary-600, var(--accent))'
                    : 'var(--border)',
                  cursor: 'pointer',
                }}
              >
                {accountId === 'all' ? `All (${conversations.length})` : (accountLabels[accountId] ?? accountId)}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between bg-opacity-50 px-4 py-3" style={{ backgroundColor: 'var(--bg-primary, transparent)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
          Recent
        </span>
        {totalUnread > 0 && <UnreadBadge count={totalUnread} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center px-6 text-center">
            <div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
              style={{ backgroundColor: 'var(--color-gray-100)' }}
            >
              <svg
                className="h-8 w-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{ color: 'var(--color-gray-400)' }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <p className="mb-1 text-sm font-medium" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
              {hasFilters ? 'No matching conversations' : 'No recent messages'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
              {hasFilters
                ? 'Try a different account filter, name, or search term.'
                : 'Messages from the last sync window will appear here.'}
            </p>
          </div>
        ) : (
          <>
            {conversations.map((conversation, index) => {
              const isSelected = conversation.conversationId === selected?.conversationId;
              const timeStr = formatRelativeTime(conversation.lastMessage.sentAt);
              const hasUnread = conversation.unreadCount > 0;
              const lastMessageLabel = (() => {
                if (conversation.lastMessage.sentByMe && conversation.lastMessage.status === 'sending') {
                  return `Sending... ${conversation.lastMessage.text}`;
                }
                if (conversation.lastMessage.sentByMe && conversation.lastMessage.status === 'failed') {
                  return `Failed to send: ${conversation.lastMessage.text}`;
                }
                return `${conversation.lastMessage.sentByMe ? 'You: ' : ''}${conversation.lastMessage.text}`;
              })();

              return (
                <button
                  type="button"
                  key={conversation.conversationId}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  onClick={() => onSelect(conversation)}
                  onKeyDown={(event) => handleItemKeyDown(event, index)}
                  aria-pressed={isSelected}
                  data-selected={isSelected ? 'true' : 'false'}
                  aria-label={`Open conversation with ${conversation.participant.name}`}
                  className="interactive-row flex w-full items-start gap-3 px-4 py-3 text-left"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    borderLeft: isSelected
                      ? '3px solid var(--color-primary-500, var(--accent))'
                      : '3px solid transparent',
                  }}
                >
                  <div className="relative flex-shrink-0">
                    <Avatar
                      name={conversation.participant.name}
                      size="md"
                      src={conversation.participant.avatarUrl}
                    />
                    {hasUnread && (
                      <div
                        className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2"
                        style={{
                          backgroundColor: 'var(--color-primary-500, #3b82f6)',
                          borderColor: 'var(--bg-secondary, white)',
                        }}
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm ${hasUnread ? 'font-semibold' : 'font-medium'}`}
                        style={{ color: 'var(--text-primary-new, var(--text-primary))' }}
                      >
                        {conversation.participant.name}
                      </span>
                      <span className="flex-shrink-0 text-xs" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
                        {timeStr}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`truncate text-xs ${hasUnread ? 'font-medium' : ''}`}
                        style={{
                          color: hasUnread
                            ? 'var(--text-secondary, var(--text-primary))'
                            : 'var(--text-muted-new, var(--text-muted))',
                        }}
                      >
                        {lastMessageLabel}
                      </p>
                      {hasUnread && <UnreadBadge count={conversation.unreadCount} />}
                    </div>

                    <div className="mt-1">
                      <AccountBadge name={accountLabels[conversation.accountId] ?? conversation.accountId} />
                    </div>
                  </div>
                </button>
              );
            })}

            {canLoadMore && (
              <div className="border-t px-4 py-4" style={{ borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  className="button-outline w-full rounded-xl px-4 py-2.5 text-sm font-medium"
                  style={{
                    cursor: isLoadingMore ? 'wait' : 'pointer',
                    opacity: isLoadingMore ? 0.75 : 1,
                  }}
                >
                  {isLoadingMore ? 'Loading more...' : 'Load more conversations'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
