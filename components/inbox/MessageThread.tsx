'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Conversation, Message } from '@/types/dashboard';
import { AlertCircle, ArrowLeft, CheckCheck, LoaderCircle, RotateCcw } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { AccountBadge } from '@/components/ui/AccountBadge';
import { ReplyInput } from '@/components/inbox/ReplyInput';
import { sendMessageNew } from '@/lib/api-client';
import {
  buildThreadSignature,
  getConversationSelectionKey,
  getThreadScrollDecision,
  shouldShowJumpToLatest,
} from '@/lib/inbox-thread-state';
import { formatRelativeTime, formatTimestamp } from '@/lib/time-utils';
import { ExportButton } from '@/components/ui/ExportButton';
import { MessageThreadSkeleton } from '@/components/ui/SkeletonLoader';
import toast from 'react-hot-toast';

interface MessageThreadProps {
  conversation: Conversation | null;
  isLoadingConversation?: boolean;
  accountLabelById: Record<string, string>;
  onMessageSent: (updated: Conversation) => void;
  onSyncAfterSend?: () => Promise<void>;
  onBack?: () => void;
}

type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

const MESSAGE_GROUP_WINDOW_MS = 2 * 60 * 1000;
const NEAR_BOTTOM_THRESHOLD_PX = 72;

function isPreviewConversationId(conversationId: string): boolean {
  return conversationId.startsWith('activity-') || conversationId.startsWith('fallback-');
}

function getConversationProfileUrl(conversation: Conversation): string {
  return conversation.participant.profileUrl?.trim() || '';
}

function logThreadMessages(label: string, messages: Message[]) {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  console.debug(
    `[Inbox][Thread] ${label}`,
    messages.map((message) => ({
      id: message.id,
      text: message.text,
      sentAt: message.sentAt,
      sentByMe: message.sentByMe,
      senderName: message.senderName,
      status: message.status,
    }))
  );
}

function normalizeThreadMessageText(value: string | undefined | null): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getRenderableMessageKey(message: Message, accountId: string, conversationId: string): string {
  const stableId = String(message.id || '').trim();
  if (stableId) {
    return stableId;
  }

  return [
    accountId,
    conversationId,
    message.sentByMe ? '__self__' : normalizeThreadMessageText(message.senderName).toLowerCase(),
    normalizeThreadMessageText(message.text).toLowerCase(),
    String(message.sentAt || 0),
  ].join(':');
}

function getScrollMetrics(container: HTMLDivElement | null): ScrollMetrics | null {
  if (!container) {
    return null;
  }

  return {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
  };
}

function isNearBottom(metrics: ScrollMetrics | null): boolean {
  if (!metrics) {
    return true;
  }

  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
}

export function MessageThread({
  conversation,
  isLoadingConversation = false,
  accountLabelById,
  onMessageSent,
  onSyncAfterSend,
  onBack,
}: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const previousSignatureRef = useRef<ReturnType<typeof buildThreadSignature> | null>(null);
  const lastScrollMetricsRef = useRef<ScrollMetrics | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const userHasManuallyScrolledRef = useRef(false);
  const pendingScrollIntentRef = useRef<'send' | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const conversationKey = getConversationSelectionKey(conversation);
  const messages = useMemo(() => conversation?.messages ?? [], [conversation]);

  const updateJumpToLatestVisibility = useCallback((): void => {
    const nextVisible = shouldShowJumpToLatest(
      userHasManuallyScrolledRef.current,
      isNearBottomRef.current
    );
    setShowJumpToLatest((currentVisible) => (currentVisible === nextVisible ? currentVisible : nextVisible));
  }, []);

  const finalizeProgrammaticScroll = useCallback((): void => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
        const nextMetrics = getScrollMetrics(messagesContainerRef.current);
        if (!nextMetrics) {
          return;
        }

        lastScrollMetricsRef.current = nextMetrics;
        isNearBottomRef.current = isNearBottom(nextMetrics);
        if (isNearBottomRef.current) {
          userHasManuallyScrolledRef.current = false;
        }
        updateJumpToLatestVisibility();
      });
    });
  }, [updateJumpToLatestVisibility]);

  const performProgrammaticScroll = useCallback((mutator: () => void): void => {
    isProgrammaticScrollRef.current = true;
    mutator();
    finalizeProgrammaticScroll();
  }, [finalizeProgrammaticScroll]);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    if (!conversationKey) {
      previousSignatureRef.current = null;
      lastScrollMetricsRef.current = getScrollMetrics(container);
      isNearBottomRef.current = true;
      userHasManuallyScrolledRef.current = false;
      setShowJumpToLatest(false);
      return;
    }

    const currentMetrics = getScrollMetrics(container);
    if (currentMetrics) {
      lastScrollMetricsRef.current = currentMetrics;
    }

    if (isLoadingConversation) {
      return;
    }

    const nextSignature = buildThreadSignature(conversationKey, messages);
    const previousSignature = previousSignatureRef.current;
    const previousMetrics = lastScrollMetricsRef.current;
    const scrollDecision = getThreadScrollDecision({
      previousSignature,
      nextSignature,
      userHasManuallyScrolled: userHasManuallyScrolledRef.current,
      isNearBottom: isNearBottomRef.current,
      forceScrollToLatest: pendingScrollIntentRef.current === 'send',
    });

    if (process.env.NODE_ENV !== 'production') {
      console.debug('[Inbox][ThreadScroll]', {
        conversationKey,
        previousTailSignature: previousSignature?.tailSignature ?? '',
        nextTailSignature: nextSignature.tailSignature,
        scrollDecision: scrollDecision.action,
        reason: scrollDecision.reason,
      });
    }

    if (scrollDecision.action === 'scroll-to-latest') {
      userHasManuallyScrolledRef.current = false;
      isNearBottomRef.current = true;
      setShowJumpToLatest(false);
      performProgrammaticScroll(() => {
        if (scrollDecision.behavior === 'smooth') {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          return;
        }

        container.scrollTop = container.scrollHeight;
      });
    } else if (previousMetrics) {
      const nextMetrics = getScrollMetrics(container);
      if (nextMetrics) {
        const shouldUseHeightDelta =
          Boolean(previousSignature) &&
          nextSignature.messageCount !== previousSignature!.messageCount &&
          !scrollDecision.trueTailAppend;
        const rawScrollTop = shouldUseHeightDelta
          ? previousMetrics.scrollTop + (nextMetrics.scrollHeight - previousMetrics.scrollHeight)
          : previousMetrics.scrollTop;
        const maxScrollTop = Math.max(0, nextMetrics.scrollHeight - nextMetrics.clientHeight);
        const restoredScrollTop = Math.max(0, Math.min(rawScrollTop, maxScrollTop));

        performProgrammaticScroll(() => {
          container.scrollTop = restoredScrollTop;
        });
      }
    }

    previousSignatureRef.current = nextSignature;
    pendingScrollIntentRef.current = null;
  }, [conversationKey, isLoadingConversation, messages, performProgrammaticScroll]);

  const handleScroll = () => {
    const nextMetrics = getScrollMetrics(messagesContainerRef.current);
    if (!nextMetrics) return;

    lastScrollMetricsRef.current = nextMetrics;
    isNearBottomRef.current = isNearBottom(nextMetrics);

    if (!isProgrammaticScrollRef.current) {
      userHasManuallyScrolledRef.current = !isNearBottomRef.current;
    } else if (isNearBottomRef.current) {
      userHasManuallyScrolledRef.current = false;
    }

    updateJumpToLatestVisibility();
  };

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center px-8 text-center" style={{ backgroundColor: 'var(--inbox-thread-panel)' }}>
        <div className="max-w-md">
          <div
            className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[28px]"
            style={{ backgroundColor: 'var(--inbox-thread-bg)' }}
          >
            <svg
              className="h-10 w-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ color: 'var(--text-muted-new, var(--text-muted))' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-lg font-semibold" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
            Select a conversation
          </p>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
            Choose a thread from the left to review synced LinkedIn messages, reply, or export the chat.
          </p>
        </div>
      </div>
    );
  }

  const { participant, accountId } = conversation;
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

    const updatedMessages: Message[] = messageId
      ? activeConversation.messages.map((message) =>
          message.id === targetId ? { ...message, ...optimisticMessage } : message
        )
      : [...activeConversation.messages, optimisticMessage];

    const updatedConversation: Conversation = {
      ...activeConversation,
      messages: updatedMessages,
      lastMessage: { text, sentAt: nextSentAt, sentByMe: true, status: 'sending' },
    };

    pendingScrollIntentRef.current = 'send';
    logThreadMessages(`before send update ${activeConversation.conversationId}`, activeConversation.messages);
    logThreadMessages(`after optimistic send ${updatedConversation.conversationId}`, updatedConversation.messages);
    onMessageSent(updatedConversation);

    try {
      const profileUrl = getConversationProfileUrl(activeConversation);
      let didSend = false;

      if (profileUrl) {
        await sendMessageNew({ accountId, profileUrl, text });
        didSend = true;
      } else if (isPreviewConversationId(activeConversation.conversationId)) {
        throw new Error('This preview conversation is missing a LinkedIn profile URL. Run sync and retry.');
      } else {
        await sendMessageNew({
          accountId,
          chatId: activeConversation.conversationId,
          text,
        });
        didSend = true;
      }

      const confirmedAt = Date.now();
      const confirmedMessages: Message[] = updatedConversation.messages.map((message): Message =>
        message.id === targetId
          ? { ...message, sentAt: confirmedAt, status: 'sent', error: null }
          : message
      );
      const confirmedConversation: Conversation = {
        ...updatedConversation,
        messages: confirmedMessages,
        lastMessage: { text, sentAt: confirmedAt, sentByMe: true, status: 'sent' },
      };
      pendingScrollIntentRef.current = 'send';
      logThreadMessages(`after confirmed send ${confirmedConversation.conversationId}`, confirmedConversation.messages);
      onMessageSent(confirmedConversation);

      if (didSend && onSyncAfterSend) {
        void onSyncAfterSend().catch(() => undefined);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';

      const failedMessages: Message[] = updatedConversation.messages.map((message): Message =>
        message.id === targetId
          ? { ...message, status: 'failed', error: errorMessage }
          : message
      );
      const failedConversation: Conversation = {
        ...updatedConversation,
        messages: failedMessages,
        lastMessage: { text, sentAt: nextSentAt, sentByMe: true, status: 'failed' },
      };
      logThreadMessages(`after failed send ${failedConversation.conversationId}`, failedConversation.messages);
      onMessageSent(failedConversation);

      toast.error(errorMessage);
    }
  }

  const groupedMessages = groupConsecutiveMessages(
    [...messages].sort((left, right) => (Number(left.sentAt) || 0) - (Number(right.sentAt) || 0))
  );

  return (
    <div className="inbox-thread-shell relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="inbox-thread-header shrink-0 border-b px-8 py-5 max-[900px]:px-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back to conversation list"
                className="button-outline hidden h-10 w-10 items-center justify-center rounded-full max-[900px]:inline-flex"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <Avatar name={participant.name} size="lg" src={participant.avatarUrl} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
                  {participant.name}
                </h2>
                <AccountBadge name={accountLabel} />
              </div>
              <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
                {isLoadingConversation
                  ? 'Loading thread...'
                  : `${messages.length} ${messages.length === 1 ? 'message' : 'messages'} in this thread`}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ExportButton
              type="messages"
              accountId={accountId}
              conversationId={conversation.conversationId}
              label="Export chat"
              size="sm"
              variant="ghost"
            />
          </div>
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="inbox-thread-scroll min-h-0 flex-1 overflow-y-auto px-8 py-6 max-[900px]:px-4"
      >
        {isLoadingConversation ? (
          <div className="max-w-3xl">
            <MessageThreadSkeleton />
          </div>
        ) : groupedMessages.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-6 text-center">
            <div className="max-w-sm">
              <p className="text-base font-semibold" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
                No messages yet
              </p>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
                This thread is ready for a first reply once the next message arrives.
              </p>
            </div>
          </div>
        ) : (
          groupedMessages.map((group) => (
            <MessageGroup
              key={getMessageGroupKey(group)}
              messages={group.messages}
              isSentByMe={group.isSentByMe}
              senderName={group.senderName}
              accountId={accountId}
              conversationId={conversation.conversationId}
              participantAvatarUrl={participant.avatarUrl}
              onRetry={handleSend}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {!isLoadingConversation && showJumpToLatest && (
        <button
          type="button"
          onClick={() => {
            userHasManuallyScrolledRef.current = false;
            isNearBottomRef.current = true;
            setShowJumpToLatest(false);
            performProgrammaticScroll(() => {
              bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            });
          }}
          className="absolute bottom-28 right-8 z-10 rounded-full px-4 py-2 text-sm font-medium shadow-lg transition-colors max-[900px]:right-4"
          style={{ backgroundColor: 'var(--inbox-jump-button-bg)', color: 'var(--inbox-jump-button-text)' }}
        >
          Jump to latest
        </button>
      )}

      <ReplyInput onSend={handleSend} disabled={isLoadingConversation} />
    </div>
  );
}

function groupConsecutiveMessages(messages: Message[]): Array<{ messages: Message[]; isSentByMe: boolean; senderName: string }> {
  const groups: Array<{ messages: Message[]; isSentByMe: boolean; senderName: string }> = [];

  messages.forEach((message) => {
    const lastGroup = groups[groups.length - 1];
    const lastMessageInGroup = lastGroup?.messages[lastGroup.messages.length - 1];
    const withinGroupWindow = lastMessageInGroup
      ? Math.abs((Number(message.sentAt) || 0) - (Number(lastMessageInGroup.sentAt) || 0)) <= MESSAGE_GROUP_WINDOW_MS
      : false;

    if (
      lastGroup &&
      lastGroup.isSentByMe === message.sentByMe &&
      lastGroup.senderName === message.senderName &&
      withinGroupWindow
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

function getMessageGroupKey(group: { messages: Message[]; isSentByMe: boolean; senderName: string }): string {
  const firstMessage = group.messages[0];
  const lastMessage = group.messages[group.messages.length - 1];

  return [
    group.isSentByMe ? 'me' : 'them',
    group.senderName,
    firstMessage?.id || firstMessage?.sentAt || 'first',
    lastMessage?.id || lastMessage?.sentAt || 'last',
    group.messages.length,
  ].join(':');
}

function MessageGroup({
  messages,
  isSentByMe,
  senderName,
  accountId,
  conversationId,
  participantAvatarUrl,
  onRetry,
}: {
  messages: Message[];
  isSentByMe: boolean;
  senderName: string;
  accountId: string;
  conversationId: string;
  participantAvatarUrl?: string | null;
  onRetry: (text: string, messageId?: string) => Promise<void>;
}) {
  return (
    <div className={`mb-7 flex w-full items-end gap-3 ${isSentByMe ? 'justify-end' : 'justify-start'}`}>
      {!isSentByMe && (
        <div className="flex-shrink-0 self-end pb-6">
          <Avatar
            name={senderName}
            size="sm"
            src={participantAvatarUrl}
          />
        </div>
      )}

      <div className={`flex min-w-0 flex-1 flex-col gap-3 ${isSentByMe ? 'items-end' : 'items-start'}`}>
        {messages.map((message, index) => (
          <MessageBubble
            key={getRenderableMessageKey(message, accountId, conversationId)}
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
  const bubbleStateClass = isSentByMe
    ? isFailed
      ? 'message-bubble--failed'
      : isSending
        ? 'message-bubble--sending'
        : 'message-bubble--outgoing'
    : 'message-bubble--incoming';

  return (
    <div className={`flex w-full min-w-0 flex-col ${isSentByMe ? 'items-end' : 'items-start'}`}>
      <div className={`message-bubble ${bubbleStateClass} block min-w-[80px] max-w-[min(70%,680px)] px-4 py-3 text-sm leading-6 max-[900px]:max-w-[85%] ${
        isSentByMe ? 'rounded-3xl rounded-br-md' : 'rounded-3xl rounded-bl-md'
      }`}>
        <span className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message.text}
        </span>
      </div>

      {isLast && (
        <div className={`message-meta mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-[12px] font-medium leading-5 ${isSentByMe ? 'justify-end text-right' : 'justify-start text-left'}`}>
          <span>
            {formatRelativeTime(message.sentAt)}
          </span>
          <span aria-hidden="true">•</span>
          <span>{formatTimestamp(message.sentAt)}</span>

          {isSentByMe && deliveryStatus === 'sending' && (
            <>
              <span aria-hidden="true">•</span>
              <LoaderCircle size={13} className="animate-spin" style={{ color: 'var(--inbox-status-pending)' }} />
              <span style={{ color: 'var(--inbox-status-pending)' }}>
                Sending...
              </span>
            </>
          )}

          {isSentByMe && deliveryStatus === 'sent' && (
            <>
              <span aria-hidden="true">•</span>
              <CheckCheck size={13} style={{ color: 'var(--inbox-status-sent)' }} />
              <span style={{ color: 'var(--inbox-status-sent)' }}>
                Sent
              </span>
            </>
          )}

          {isSentByMe && deliveryStatus === 'failed' && (
            <>
              <span aria-hidden="true">•</span>
              <AlertCircle size={13} style={{ color: 'var(--inbox-status-failed)' }} />
              <span style={{ color: 'var(--inbox-status-failed)' }}>
                Failed
              </span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors"
                  style={{
                    color: 'var(--inbox-status-failed)',
                    backgroundColor: 'var(--inbox-retry-bg)',
                  }}
                >
                  <RotateCcw size={11} />
                  Retry
                </button>
              )}
            </>
          )}
        </div>
      )}

      {isSentByMe && message.error && isFailed && (
        <p className="mt-1 max-w-[min(70%,680px)] px-1 text-xs leading-5 max-[900px]:max-w-[85%]" style={{ color: 'var(--inbox-status-failed)' }}>
          {message.error}
        </p>
      )}
    </div>
  );
}
