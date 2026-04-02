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
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation?.messages, autoScroll]);

  // Detect if user is scrolled up
  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setAutoScroll(isNearBottom);
    }
  };

  if (!conversation) {
    return (
      <div 
        className="flex-1 flex items-center justify-center" 
        style={{ backgroundColor: 'var(--bg-secondary, #ffffff)' }}
      >
        <div className="text-center px-6">
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
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
    if (!conversation) return;

    // Optimistic update — show message immediately without waiting for network
    const optimistic: Message = {
      id:         `opt-${Date.now()}`,
      text,
      sentAt:     Date.now(),
      sentByMe:   true,
      senderName: accountId,
    };
    const updated: Conversation = {
      ...conversation,
      messages:    [...conversation.messages, optimistic],
      lastMessage: { text, sentAt: Date.now(), sentByMe: true },
    };
    onMessageSent(updated);

    // Fire real request in background — chatId = conversationId
    try {
      await sendMessage(accountId, conversation.conversationId, text);
    } catch (err) {
      const withoutOptimistic = updated.messages.filter((m) => m.id !== optimistic.id);
      const fallbackLast = withoutOptimistic[withoutOptimistic.length - 1];

      onMessageSent({
        ...updated,
        messages: withoutOptimistic,
        lastMessage: fallbackLast
          ? { text: fallbackLast.text, sentAt: fallbackLast.sentAt, sentByMe: fallbackLast.sentByMe }
          : conversation.lastMessage,
      });

      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    }
  }

  // Group consecutive messages from the same sender
  const groupedMessages = groupConsecutiveMessages(messages);

  return (
    <div className="flex-1 flex flex-col" style={{ backgroundColor: 'var(--bg-secondary, #ffffff)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ 
          borderColor: 'var(--border-color, var(--border))',
          backgroundColor: 'var(--bg-secondary, var(--bg-panel))',
        }}
      >
        <div className="flex items-center gap-3">
          <Avatar name={participant.name} size="md" />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
              {participant.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </p>
          </div>
        </div>
        <AccountBadge name={accountId} />
      </div>

      {/* Messages */}
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-6" 
        style={{ backgroundColor: 'var(--bg-primary, var(--bg-base))' }}
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

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="absolute bottom-24 right-8 px-4 py-2 rounded-full shadow-lg transition-all"
          style={{
            backgroundColor: 'var(--color-primary-500)',
            color: 'white',
          }}
        >
          ↓ New messages
        </button>
      )}

      <ReplyInput onSend={handleSend} />
    </div>
  );
}

// Helper function to group consecutive messages from the same sender
function groupConsecutiveMessages(messages: Message[]): Array<{ messages: Message[]; isSentByMe: boolean; senderName: string }> {
  const groups: Array<{ messages: Message[]; isSentByMe: boolean; senderName: string }> = [];
  
  messages.forEach((msg) => {
    const lastGroup = groups[groups.length - 1];
    
    if (lastGroup && lastGroup.isSentByMe === msg.sentByMe && lastGroup.senderName === msg.senderName) {
      lastGroup.messages.push(msg);
    } else {
      groups.push({
        messages: [msg],
        isSentByMe: msg.sentByMe,
        senderName: msg.senderName,
      });
    }
  });
  
  return groups;
}

function MessageGroup({ messages, isSentByMe, senderName }: { messages: Message[]; isSentByMe: boolean; senderName: string }) {
  return (
    <div className={`flex gap-3 mb-6 ${isSentByMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar - only show once per group */}
      <div className="flex-shrink-0">
        <Avatar name={senderName} size="sm" />
      </div>
      
      {/* Message bubbles */}
      <div className={`flex flex-col gap-1 max-w-[70%] ${isSentByMe ? 'items-end' : 'items-start'}`}>
        {/* Sender name above first message */}
        <span 
          className="text-xs font-medium mb-1 px-2" 
          style={{ color: 'var(--text-muted-new, var(--text-muted))' }}
        >
          {senderName}
        </span>
        
        {messages.map((msg, index) => (
          <MessageBubble 
            key={msg.id} 
            message={msg} 
            isSentByMe={isSentByMe}
            isLast={index === messages.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message, isSentByMe, isLast }: { message: Message; isSentByMe: boolean; isLast: boolean }) {
  const { text, sentAt } = message;

  return (
    <div className="w-full">
      <div
        className={`inline-block px-4 py-3 text-sm leading-relaxed transition-all ${
          isSentByMe 
            ? 'rounded-2xl rounded-br-sm' 
            : 'rounded-2xl rounded-bl-sm'
        }`}
        style={{
          backgroundColor: isSentByMe 
            ? 'var(--color-primary-500, #3b82f6)' 
            : 'var(--bg-card, var(--color-gray-100))',
          color: isSentByMe 
            ? '#ffffff' 
            : 'var(--text-primary-new, var(--text-primary))',
          maxWidth: '100%',
          wordBreak: 'break-word',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {text}
      </div>
      
      {/* Timestamp - only show on last message of group */}
      {isLast && (
        <div className={`flex items-center gap-1 mt-1 px-2 ${isSentByMe ? 'justify-end' : 'justify-start'}`}>
          <span 
            className="text-xs" 
            style={{ color: 'var(--text-muted-new, var(--text-muted))' }}
          >
            {formatRelativeTime(sentAt)}
          </span>
          {isSentByMe && (
            <CheckCheck 
              size={14} 
              style={{ color: 'var(--color-primary-500, #3b82f6)' }} 
            />
          )}
        </div>
      )}
    </div>
  );
}
