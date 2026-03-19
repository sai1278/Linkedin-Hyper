'use client';

import { useRef, useEffect } from 'react';
import type { Conversation, Message } from '@/types/dashboard';
import { Avatar } from '@/components/ui/Avatar';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { ReplyInput } from '@/components/inbox/ReplyInput';
import { groupByDate, timeAgo } from '@/lib/utils';
import { sendMessage } from '@/lib/api-client';

interface MessageThreadProps {
  conversation: Conversation | null;
  onMessageSent: (updated: Conversation) => void;
}

export function MessageThread({ conversation, onMessageSent }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages]);

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium" style={{ color: 'var(--text-muted)' }}>
            Select a conversation
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Choose from the left panel to start messaging
          </p>
        </div>
      </div>
    );
  }

  const { participant, accountId, messages } = conversation;
  const groups = groupByDate(messages);

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
    } catch {
      // Silently fail — optimistic message remains visible
    }
  }

  return (
    <div className="flex-1 flex flex-col" style={{ background: 'var(--bg-base)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {participant.name}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            via LinkedIn · {accountId} · {messages.length} msgs
          </p>
        </div>
        <AccountBadge name={accountId} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {groups.map(({ label, messages: groupMsgs }) => (
          <div key={label}>
            {/* Date separator */}
            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              <span className="text-xs px-2" style={{ color: 'var(--text-muted)' }}>
                {label}
              </span>
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            </div>
            {groupMsgs.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <ReplyInput onSend={handleSend} />
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const { senderName, text, sentAt, sentByMe } = message;

  return (
    <div className={`flex gap-3 mb-3 ${sentByMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {!sentByMe && <Avatar name={senderName} size="sm" />}
      <div className={`flex flex-col max-w-[65%] ${sentByMe ? 'items-end' : 'items-start'}`}>
        <div
          className={`flex items-center gap-2 mb-1 ${sentByMe ? 'flex-row-reverse' : 'flex-row'}`}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {senderName}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {timeAgo(sentAt)}
          </span>
        </div>
        <div
          className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
          style={{
            background:  sentByMe ? 'rgba(108,99,255,0.2)' : 'var(--bg-card)',
            color:       'var(--text-primary)',
            border:      '1px solid',
            borderColor: sentByMe ? 'rgba(108,99,255,0.3)' : 'var(--border)',
          }}
        >
          {text}
        </div>
      </div>
      {sentByMe && <Avatar name={senderName} size="sm" />}
    </div>
  );
}
