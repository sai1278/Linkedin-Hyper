'use client';

import { useRef, useEffect, useState } from 'react';
import type { Conversation, Message } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { ReplyInput } from '@/components/inbox/ReplyInput';
import { sendMessage } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/time-utils';
import { CheckCheck } from 'lucide-react';
import toast from 'react-hot-toast';

interface MessageThreadProps {
  conversation: Conversation | null;
  onMessageSent: (updated: Conversation) => void;
}

export function MessageThread({ conversation, onMessageSent }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--bg-secondary, #ffffff)' }}>
        <div className="text-center px-6 animate-fade-in">
          <div
            className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-gray-100)' }}
          >
            <svg
              className="w-10 h-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ color: 'var(--color-gray-400)' }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <p className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
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

  async function handleSend(text: string) {
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      text,
      sentAt: Date.now(),
      sentByMe: true,
      senderName: accountId,
    };

    const updatedConversation: Conversation = {
      ...conversation,
      messages: [...conversation.messages, optimistic],
      lastMessage: { text, sentAt: Date.now(), sentByMe: true },
    };

    onMessageSent(updatedConversation);

    try {
      await sendMessage(accountId, conversation.conversationId, text);
    } catch (error) {
      const withoutOptimistic = updatedConversation.messages.filter((m) => m.id !== optimistic.id);
      const fallbackLast = withoutOptimistic[withoutOptimistic.length - 1];

      onMessageSent({
        ...updatedConversation,
        messages: withoutOptimistic,
        lastMessage: fallbackLast
          ? {
              text: fallbackLast.text,
              sentAt: fallbackLast.sentAt,
              sentByMe: fallbackLast.sentByMe,
            }
          : conversation.lastMessage,
      });

      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    }
  }

  const groupedMessages = groupConsecutiveMessages(messages);

  return (
    <div className="flex-1 flex flex-col relative" style={{ backgroundColor: 'var(--bg-secondary, #ffffff)' }}>
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{
          borderColor: 'var(--border-color, var(--border))',
          background:
            'linear-gradient(180deg, rgba(43, 184, 255, 0.11) 0%, rgba(43, 184, 255, 0.02) 100%)',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={participant.name} size="md" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
              {participant.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </p>
          </div>
        </div>
        <AccountBadge name={accountId} />
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-6"
        style={{
          background:
            'radial-gradient(1000px circle at 0% 0%, rgba(43, 184, 255, 0.08), transparent 54%), var(--bg-primary, var(--bg-base))',
        }}
      >
        {groupedMessages.map((group, groupIndex) => (
          <MessageGroup
            key={groupIndex}
            messages={group.messages}
            isSentByMe={group.isSentByMe}
            senderName={group.senderName}
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
          className="absolute bottom-24 right-8 px-4 py-2 rounded-full shadow-lg transition-all text-sm font-medium"
          style={{
            background: 'linear-gradient(135deg, #1d8fff 0%, #2bb8ff 100%)',
            color: 'white',
            boxShadow: '0 10px 24px rgba(20, 126, 203, 0.45)',
          }}
        >
          Jump to latest
        </button>
      )}

      <ReplyInput onSend={handleSend} />
    </div>
  );
}

function groupConsecutiveMessages(
  messages: Message[]
): Array<{ messages: Message[]; isSentByMe: boolean; senderName: string }> {
  const groups: Array<{ messages: Message[]; isSentByMe: boolean; senderName: string }> = [];

  messages.forEach((message) => {
    const lastGroup = groups[groups.length - 1];
    if (
      lastGroup &&
      lastGroup.isSentByMe === message.sentByMe &&
      lastGroup.senderName === message.senderName
    ) {
      lastGroup.messages.push(message);
    } else {
      groups.push({
        messages: [message],
        isSentByMe: message.sentByMe,
        senderName: message.senderName,
      });
    }
  });

  return groups;
}

function MessageGroup({
  messages,
  isSentByMe,
  senderName,
}: {
  messages: Message[];
  isSentByMe: boolean;
  senderName: string;
}) {
  return (
    <div className={`flex gap-3 mb-7 ${isSentByMe ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="flex-shrink-0">
        <Avatar name={senderName} size="sm" />
      </div>

      <div className={`flex flex-col gap-1.5 max-w-[76%] ${isSentByMe ? 'items-end' : 'items-start'}`}>
        <span className="text-xs font-medium mb-1 px-2" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
          {senderName}
        </span>

        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isSentByMe={isSentByMe}
            isLast={index === messages.length - 1}
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
}: {
  message: Message;
  isSentByMe: boolean;
  isLast: boolean;
}) {
  const { text, sentAt } = message;

  return (
    <div className="w-full animate-fade-in">
      <div
        className={`inline-block px-4 py-3 text-sm leading-relaxed transition-all ${
          isSentByMe ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm'
        }`}
        style={{
          background: isSentByMe
            ? 'linear-gradient(135deg, #1f8fff 0%, #2bb8ff 100%)'
            : 'var(--bg-card, var(--color-gray-100))',
          color: isSentByMe ? '#ffffff' : 'var(--text-primary-new, var(--text-primary))',
          maxWidth: '100%',
          wordBreak: 'break-word',
          boxShadow: isSentByMe
            ? '0 10px 20px rgba(11, 89, 150, 0.35)'
            : '0 6px 14px rgba(5, 10, 19, 0.2)',
        }}
      >
        {text}
      </div>

      {isLast && (
        <div className={`flex items-center gap-1 mt-1 px-2 ${isSentByMe ? 'justify-end' : 'justify-start'}`}>
          <span className="text-xs" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
            {formatRelativeTime(sentAt)}
          </span>
          {isSentByMe && <CheckCheck size={14} style={{ color: 'var(--color-primary-500, #3b82f6)' }} />}
        </div>
      )}
    </div>
  );
}
