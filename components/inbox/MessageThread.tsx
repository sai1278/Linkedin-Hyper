'use client';

import { useEffect, useRef, useState } from 'react';
import type { Conversation, Message } from '@/types/dashboard';
import { AlertCircle, ArrowLeft, CheckCheck, LoaderCircle, RotateCcw } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { ReplyInput } from '@/components/inbox/ReplyInput';
import { sendMessage } from '@/lib/api-client';
import { formatRelativeTime, formatTimestamp } from '@/lib/time-utils';
import { ExportButton } from '@/components/ui/ExportButton';
import toast from 'react-hot-toast';

interface MessageThreadProps {
  conversation: Conversation | null;
  accountLabelById: Record<string, string>;
  onMessageSent: (updated: Conversation) => void;
  onBack?: () => void;
}

export function MessageThread({ conversation, accountLabelById, onMessageSent, onBack }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation?.messages, autoScroll]);

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isNearBottom);
  };

  if (!conversation) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ backgroundColor: 'var(--bg-secondary, #ffffff)' }}
      >
        <div className="px-6 text-center">
          <div
            className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--color-gray-100)' }}
          >
            <svg
              className="h-10 w-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ color: 'var(--color-gray-400)' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
            Select a conversation
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
            Choose from the left panel to start messaging
          </p>
        </div>
      </div>
    );
  }

  const { participant, accountId, messages } = conversation;
  const accountLabel = accountLabelById[accountId] ?? accountId;

  async function handleSend(text: string, messageId?: string) {
    const activeConversation = conversation;
    if (!activeConversation) return;

    const nextSentAt = Date.now();
    const targetId = messageId ?? `opt-${nextSentAt}`;
    const optimisticMessage: Message = {
      id: targetId,
      text,
      sentAt: nextSentAt,
      sentByMe: true,
      senderName: accountLabel,
      status: 'sending',
      error: null,
    };

    const updatedMessages = messageId
      ? activeConversation.messages.map((message) =>
          message.id === targetId ? { ...message, ...optimisticMessage } : message
        )
      : [...activeConversation.messages, optimisticMessage];

    const updatedConversation: Conversation = {
      ...activeConversation,
      messages: updatedMessages,
      lastMessage: { text, sentAt: nextSentAt, sentByMe: true, status: 'sending' },
    };

    onMessageSent(updatedConversation);

    try {
      await sendMessage(accountId, activeConversation.conversationId, text);

      const confirmedAt = Date.now();
      onMessageSent({
        ...updatedConversation,
        messages: updatedConversation.messages.map((message) =>
          message.id === targetId
            ? { ...message, sentAt: confirmedAt, status: 'sent', error: null }
            : message
        ),
        lastMessage: { text, sentAt: confirmedAt, sentByMe: true, status: 'sent' },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';

      onMessageSent({
        ...updatedConversation,
        messages: updatedConversation.messages.map((message) =>
          message.id === targetId
            ? { ...message, status: 'failed', error: errorMessage }
            : message
        ),
        lastMessage: { text, sentAt: nextSentAt, sentByMe: true, status: 'failed' },
      });

      toast.error(errorMessage);
    }
  }

  const groupedMessages = groupConsecutiveMessages(messages);

  return (
    <div className="flex flex-1 flex-col" style={{ backgroundColor: 'var(--bg-secondary, #ffffff)' }}>
      <div
        className="flex items-center justify-between border-b px-6 py-4"
        style={{
          borderColor: 'var(--border)',
          backgroundColor: 'var(--bg-secondary, var(--bg-panel))',
        }}
      >
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversation list"
              className="button-outline hidden h-9 w-9 items-center justify-center rounded-full max-[900px]:inline-flex"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <Avatar name={participant.name} size="md" src={participant.avatarUrl} />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
              {participant.name}
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            type="messages"
            accountId={accountId}
            conversationId={conversation.conversationId}
            label="Export chat"
            size="sm"
          />
          <AccountBadge name={accountLabel} />
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-6"
        style={{ backgroundColor: 'var(--bg-primary, var(--bg-base))' }}
      >
        {groupedMessages.map((group, index) => (
            <MessageGroup
              key={`${group.senderName}-${index}`}
              messages={group.messages}
              isSentByMe={group.isSentByMe}
              senderName={group.senderName}
              accountLabel={accountLabel}
              participantAvatarUrl={participant.avatarUrl}
              onRetry={handleSend}
            />
        ))}
        <div ref={bottomRef} />
      </div>

      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="absolute bottom-24 right-8 rounded-full px-4 py-2 shadow-lg transition-all"
          style={{
            backgroundColor: 'var(--color-primary-500)',
            color: 'white',
          }}
        >
          New messages
        </button>
      )}

      <ReplyInput onSend={handleSend} />
    </div>
  );
}

function groupConsecutiveMessages(messages: Message[]): Array<{ messages: Message[]; isSentByMe: boolean; senderName: string }> {
  const groups: Array<{ messages: Message[]; isSentByMe: boolean; senderName: string }> = [];

  messages.forEach((message) => {
    const lastGroup = groups[groups.length - 1];

    if (
      lastGroup &&
      lastGroup.isSentByMe === message.sentByMe &&
      lastGroup.senderName === message.senderName
    ) {
      lastGroup.messages.push(message);
      return;
    }

    groups.push({
      messages: [message],
      isSentByMe: message.sentByMe,
      senderName: message.senderName,
    });
  });

  return groups;
}

function MessageGroup({
  messages,
  isSentByMe,
  senderName,
  accountLabel,
  participantAvatarUrl,
  onRetry,
}: {
  messages: Message[];
  isSentByMe: boolean;
  senderName: string;
  accountLabel: string;
  participantAvatarUrl?: string | null;
  onRetry: (text: string, messageId?: string) => Promise<void>;
}) {
  const displayName = isSentByMe ? accountLabel : senderName;

  return (
    <div className={`mb-6 flex gap-3 ${isSentByMe ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="flex-shrink-0">
        <Avatar
          name={displayName}
          size="sm"
          src={isSentByMe ? null : participantAvatarUrl}
        />
      </div>

      <div className={`flex max-w-[70%] flex-col gap-1 ${isSentByMe ? 'items-end' : 'items-start'}`}>
        <span className="mb-1 px-2 text-xs font-medium" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
          {displayName}
        </span>

        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isSentByMe={isSentByMe}
            isLast={index === messages.length - 1}
            onRetry={message.status === 'failed' ? () => void onRetry(message.text, message.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isSentByMe,
  isLast,
  onRetry,
}: {
  message: Message;
  isSentByMe: boolean;
  isLast: boolean;
  onRetry?: () => void;
}) {
  const deliveryStatus = message.status ?? (isSentByMe ? 'sent' : undefined);
  const isSending = deliveryStatus === 'sending';
  const isFailed = deliveryStatus === 'failed';

  return (
    <div className="w-full">
      <div
        className={`inline-block px-4 py-3 text-sm leading-relaxed transition-all ${
          isSentByMe ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm'
        }`}
        style={{
          backgroundColor: isSentByMe
            ? isFailed
              ? 'rgba(239, 68, 68, 0.12)'
              : isSending
                ? 'rgba(24, 119, 242, 0.14)'
                : 'var(--color-primary-500, #3b82f6)'
            : 'var(--bg-card, var(--color-gray-100))',
          color: isSentByMe && !isFailed && !isSending
            ? '#ffffff'
            : 'var(--text-primary-new, var(--text-primary))',
          maxWidth: '100%',
          wordBreak: 'break-word',
          boxShadow: 'var(--shadow-sm)',
          border: isFailed
            ? '1px solid rgba(239, 68, 68, 0.32)'
            : isSending
              ? '1px dashed rgba(24, 119, 242, 0.4)'
              : '1px solid transparent',
          opacity: isSending ? 0.85 : 1,
        }}
      >
        {message.text}
      </div>

      {isLast && (
        <div className={`mt-1 flex items-center gap-1 px-2 ${isSentByMe ? 'justify-end' : 'justify-start'}`}>
          <span className="text-xs" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
            {`${formatRelativeTime(message.sentAt)} • ${formatTimestamp(message.sentAt)}`}
          </span>

          {isSentByMe && deliveryStatus === 'sending' && (
            <>
              <LoaderCircle size={14} className="animate-spin" style={{ color: 'var(--color-primary-500, #3b82f6)' }} />
              <span className="text-xs" style={{ color: 'var(--color-primary-600, #166fe5)' }}>
                Sending...
              </span>
            </>
          )}

          {isSentByMe && deliveryStatus === 'sent' && (
            <>
              <CheckCheck size={14} style={{ color: 'var(--color-primary-500, #3b82f6)' }} />
              <span className="text-xs" style={{ color: 'var(--color-primary-600, #166fe5)' }}>
                Sent
              </span>
            </>
          )}

          {isSentByMe && deliveryStatus === 'failed' && (
            <>
              <AlertCircle size={14} style={{ color: '#dc2626' }} />
              <span className="text-xs" style={{ color: '#dc2626' }}>
                Failed
              </span>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-all"
                  style={{
                    color: '#dc2626',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  }}
                >
                  <RotateCcw size={12} />
                  Retry
                </button>
              )}
            </>
          )}
        </div>
      )}

      {isSentByMe && message.error && isFailed && (
        <p className="mt-1 px-2 text-xs" style={{ color: '#b91c1c' }}>
          {message.error}
        </p>
      )}
    </div>
  );
}
