'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Account, Conversation, Message } from '@/types/dashboard';
import { ApiError, getAccounts, getConversationThread, getUnifiedInbox, syncMessages } from '@/lib/api-client';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { ConversationListSkeleton, MessageThreadSkeleton } from '@/components/ui/SkeletonLoader';
import { ErrorState } from '@/components/ui/ErrorState';
import { wsClient } from '@/lib/websocket-client';
import {
  areThreadMessagesEquivalent,
  filterThreadMessagesForConversation,
  getConversationSelectionKey,
  isConfirmedThreadMessage,
  isSyntheticDemoMessage,
  isStaleOptimisticMessage,
  getThreadMessageSource,
  isSyntheticThreadMessageId,
  shouldApplyThreadResponse,
} from '@/lib/inbox-thread-state';
import { getAccountLabel } from '@/lib/account-label';
import toast from 'react-hot-toast';

type InboxNewMessagePayload = {
  chatId?: string;
};

type StatusChangedPayload = {
  status?: 'connected' | 'disconnected' | 'reconnecting';
};

const DEFAULT_RELOAD_BACKOFF_SEC = 30;

function normalizeConversationValue(value: string | undefined | null): string {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function findConversationBySelectionKey(
  conversations: Conversation[],
  selectionKey: string | null
): Conversation | null {
  if (!selectionKey) {
    return null;
  }

  return conversations.find((conversation) => getConversationSelectionKey(conversation) === selectionKey) || null;
}

function areSameConversation(left: Conversation | null | undefined, right: Conversation | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  if (left.conversationId === right.conversationId) {
    return true;
  }

  if (left.accountId !== right.accountId) {
    return false;
  }

  const leftProfile = normalizeConversationValue(left.participant.profileUrl);
  const rightProfile = normalizeConversationValue(right.participant.profileUrl);
  if (leftProfile && rightProfile && leftProfile === rightProfile) {
    return true;
  }

  return normalizeConversationValue(left.participant.name) === normalizeConversationValue(right.participant.name);
}

function normalizeMessageText(value: string | undefined | null): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

const MESSAGE_DEDUP_WINDOW_MS = 60 * 1000;

function getMessageTimestamp(message: Message | undefined | null): number {
  return Number(message?.sentAt) || 0;
}

function getMessageSenderIdentity(message: Message): string {
  if (message.sentByMe) {
    return '__self__';
  }

  return normalizeMessageText(message.senderName).toLowerCase() || 'unknown';
}

function buildMessageFallbackId(
  message: Message,
  context: { accountId?: string; conversationId?: string } = {}
): string {
  return [
    'msg',
    String(context.accountId || ''),
    String(context.conversationId || ''),
    getMessageSenderIdentity(message),
    normalizeMessageText(message.text).toLowerCase(),
    String(Math.floor(getMessageTimestamp(message) / MESSAGE_DEDUP_WINDOW_MS)),
  ].join(':');
}

function normalizeMessage(
  message: Message,
  context: { accountId?: string; conversationId?: string } = {}
): Message {
  const sentAt = getMessageTimestamp(message) || Date.now();
  const normalizedMessage: Message = {
    ...message,
    id: String(message.id || '').trim(),
    text: normalizeMessageText(message.text),
    sentAt,
    sentByMe: Boolean(message.sentByMe),
    senderName: message.sentByMe
      ? normalizeMessageText(message.senderName) || String(context.accountId || 'Me')
      : normalizeMessageText(message.senderName) || 'Unknown',
    error: message.error ?? null,
  };

  if (!normalizedMessage.id) {
    normalizedMessage.id = buildMessageFallbackId(normalizedMessage, context);
  }

  return normalizedMessage;
}

function scoreMessage(message: Message): number {
  const rawId = String(message.id || '');
  let score = 0;

  if (message.status === 'sent' || (!message.sentByMe && !message.status)) score += 40;
  if (message.status === 'sending') score += 20;
  if (message.status === 'failed') score += 10;
  if (message.error == null) score += 5;
  if (rawId && !isSyntheticThreadMessageId(rawId)) score += 5;
  if (normalizeMessageText(message.senderName)) score += 2;
  if (normalizeMessageText(message.text)) score += 2;

  return score;
}

function preferMessage(existing: Message, candidate: Message): Message {
  const preferred = scoreMessage(candidate) >= scoreMessage(existing) ? candidate : existing;
  const secondary = preferred === candidate ? existing : candidate;
  const preferredId = String(preferred.id || '').trim();
  const secondaryId = String(secondary.id || '').trim();
  const stableId = !isSyntheticThreadMessageId(preferredId)
    ? preferredId
    : (!isSyntheticThreadMessageId(secondaryId) ? secondaryId : preferredId || secondaryId);

  return {
    ...secondary,
    ...preferred,
    id: stableId || buildMessageFallbackId(preferred),
    text: preferred.text || secondary.text,
    sentAt: getMessageTimestamp(preferred) || getMessageTimestamp(secondary),
    sentByMe: preferred.sentByMe ?? secondary.sentByMe,
    senderName: preferred.senderName || secondary.senderName,
    status: preferred.status ?? secondary.status,
    error: preferred.error ?? secondary.error ?? null,
  };
}

function getMessageDedupKey(
  message: Message,
  context: { accountId?: string; conversationId?: string } = {}
): string {
  const normalizedMessage = normalizeMessage(message, context);
  const stableId = String(normalizedMessage.id || '').trim();
  if (stableId && !isSyntheticThreadMessageId(stableId)) {
    return `id:${stableId}`;
  }

  return [
    'fp',
    String(context.accountId || ''),
    String(context.conversationId || ''),
    getMessageSenderIdentity(normalizedMessage),
    normalizeMessageText(normalizedMessage.text).toLowerCase(),
    String(Math.floor(getMessageTimestamp(normalizedMessage) / MESSAGE_DEDUP_WINDOW_MS)),
  ].join(':');
}

function areProbablySameMessage(left: Message, right: Message): boolean {
  const leftId = String(left.id || '').trim();
  const rightId = String(right.id || '').trim();

  if (leftId && rightId && !isSyntheticThreadMessageId(leftId) && !isSyntheticThreadMessageId(rightId)) {
    return leftId === rightId;
  }

  const needsFuzzyMatch =
    !leftId ||
    !rightId ||
    isSyntheticThreadMessageId(leftId) ||
    isSyntheticThreadMessageId(rightId);

  if (!needsFuzzyMatch) {
    return false;
  }

  return (
    left.sentByMe === right.sentByMe &&
    getMessageSenderIdentity(left) === getMessageSenderIdentity(right) &&
    normalizeMessageText(left.text).toLowerCase() === normalizeMessageText(right.text).toLowerCase() &&
    Math.abs(getMessageTimestamp(left) - getMessageTimestamp(right)) <= MESSAGE_DEDUP_WINDOW_MS
  );
}

function mergeMessages(
  existingMessages: Message[] | undefined | null,
  incomingMessages: Message[] | undefined | null,
  context: { accountId?: string; conversationId?: string } = {},
  label = 'mergeMessages'
): Message[] {
  const existingCount = existingMessages?.length || 0;
  const incomingCount = incomingMessages?.length || 0;
  const beforeCount = existingCount + incomingCount;
  const mergedMessages: Message[] = [];
  let duplicateSkippedCount = 0;

  for (const rawMessage of [...(existingMessages || []), ...(incomingMessages || [])]) {
    if (!rawMessage) continue;

    const normalizedMessage = normalizeMessage(rawMessage, context);
    const dedupKey = getMessageDedupKey(normalizedMessage, context);
    const existingIndex = mergedMessages.findIndex((currentMessage) => (
      getMessageDedupKey(currentMessage, context) === dedupKey ||
      areProbablySameMessage(currentMessage, normalizedMessage)
    ));

    if (existingIndex >= 0) {
      duplicateSkippedCount += 1;
      mergedMessages[existingIndex] = preferMessage(mergedMessages[existingIndex], normalizedMessage);
      continue;
    }

    mergedMessages.push(normalizedMessage);
  }

  const sortedMessages = mergedMessages.sort((left, right) => {
    const sentAtDiff = getMessageTimestamp(left) - getMessageTimestamp(right);
    if (sentAtDiff !== 0) {
      return sentAtDiff;
    }

    return normalizeMessageText(left.text).localeCompare(normalizeMessageText(right.text));
  });

  console.debug(
    `[InboxMerge][${label}] accountId=${String(context.accountId || '')} threadId=${String(context.conversationId || '')} existing=${existingCount} incoming=${incomingCount} before=${beforeCount} after=${sortedMessages.length} duplicatesSkipped=${duplicateSkippedCount}`
  );

  return sortedMessages;
}

function pickLatestLastMessage(
  currentLastMessage: Conversation['lastMessage'] | null | undefined,
  nextLastMessage: Conversation['lastMessage'] | null | undefined,
  mergedMessages: Message[]
): Conversation['lastMessage'] {
  const latestMerged = mergedMessages[mergedMessages.length - 1];
  if (latestMerged) {
    return {
      text: latestMerged.text,
      sentAt: latestMerged.sentAt,
      sentByMe: latestMerged.sentByMe,
      status: latestMerged.sentByMe ? (latestMerged.status ?? 'sent') : undefined,
    };
  }

  return (currentLastMessage && nextLastMessage
    ? (getMessageTimestamp(currentLastMessage as Message) >= getMessageTimestamp(nextLastMessage as Message)
      ? currentLastMessage
      : nextLastMessage)
    : nextLastMessage || currentLastMessage || {
        text: '',
        sentAt: Date.now(),
        sentByMe: false,
        status: undefined,
      }) as Conversation['lastMessage'];
}

function logMessageArray(label: string, messages: Message[]): void {
  console.debug(`[Inbox] ${label}`, messages.map((message) => ({
    id: message.id,
    text: message.text,
    sentAt: message.sentAt,
    sentByMe: message.sentByMe,
    senderName: message.senderName,
    status: message.status,
    dedupKey: getMessageDedupKey(message),
  })));
}

function logThreadDiagnostics(label: string, conversation: Conversation | null | undefined): void {
  if (process.env.NODE_ENV === 'production' || !conversation) {
    return;
  }

  const sanitizedMessages = filterThreadMessagesForConversation(
    conversation.conversationId,
    conversation.messages
  );

  console.debug(`[Inbox][Diagnostics] ${label}`, {
    accountId: conversation.accountId,
    conversationId: conversation.conversationId,
    messageCount: sanitizedMessages.length,
    lastMessages: sanitizedMessages.slice(-10).map((message) => ({
      id: message.id,
      sentByMe: message.sentByMe,
      source: getThreadMessageSource(message.id),
      synthetic: isSyntheticDemoMessage(message) || getThreadMessageSource(message.id) !== 'persisted',
      optimistic: getThreadMessageSource(message.id) === 'optimistic',
      confirmed: isConfirmedThreadMessage(message),
      staleOptimistic: isStaleOptimisticMessage(message),
      sentAt: message.sentAt,
      text: message.text,
    })),
  });
}

export default function InboxPage() {
  const RECONNECTING_NOTICE_DELAY_MS = 2000;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationKey, setActiveConversationKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(25);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isReloadingInbox, setIsReloadingInbox] = useState(false);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [reloadCooldownUntil, setReloadCooldownUntil] = useState(0);
  const [cooldownClock, setCooldownClock] = useState(Date.now());
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>(
    wsClient.isConnected ? 'connected' : 'disconnected'
  );
  const [showConnectionStatus, setShowConnectionStatus] = useState(() => !wsClient.isConnected);
  const selectedRef = useRef<Conversation | null>(null);
  const activeConversationKeyRef = useRef<string | null>(null);
  const isThreadLoadingRef = useRef(false);
  const visibleLimitRef = useRef(25);
  const syncInFlightRef = useRef(false);
  const threadRequestTokenRef = useRef(0);

  useEffect(() => {
    if (wsStatus === 'connected') {
      setShowConnectionStatus(false);
      return;
    }

    setShowConnectionStatus(false);

    const timer = window.setTimeout(() => {
      setShowConnectionStatus(true);
    }, RECONNECTING_NOTICE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [wsStatus]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    activeConversationKeyRef.current = activeConversationKey;
  }, [activeConversationKey]);

  useEffect(() => {
    isThreadLoadingRef.current = isThreadLoading;
  }, [isThreadLoading]);

  useEffect(() => {
    if (reloadCooldownUntil <= Date.now()) {
      return;
    }

    const timer = window.setInterval(() => {
      setCooldownClock(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [reloadCooldownUntil]);

  useEffect(() => {
    visibleLimitRef.current = visibleLimit;
  }, [visibleLimit]);

  const accountLabelById = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, getAccountLabel(account)])),
    [accounts]
  );

  const getFallbackMessages = useCallback((conversation: Conversation): Message[] => {
    const filteredConversationMessages = filterThreadMessagesForConversation(
      conversation.conversationId,
      conversation.messages
    );

    if (filteredConversationMessages.length > 0) {
      return filteredConversationMessages;
    }

    if (!conversation.lastMessage?.text) {
      return [];
    }

    return [{
      id: `preview-${conversation.conversationId}`,
      text: conversation.lastMessage.text,
      sentAt: conversation.lastMessage.sentAt,
      sentByMe: conversation.lastMessage.sentByMe,
      senderName: conversation.lastMessage.sentByMe ? conversation.accountId : conversation.participant.name,
      status: conversation.lastMessage.sentByMe ? (conversation.lastMessage.status ?? 'sent') : undefined,
      error: null,
    }];
  }, []);

  const mergeConversationForDisplay = useCallback((
    currentConversation: Conversation | null | undefined,
    nextConversation: Conversation
  ): Conversation => {
    const shouldMergeCurrent = areSameConversation(currentConversation, nextConversation);
    const nextThreadMessages = filterThreadMessagesForConversation(
      nextConversation.conversationId,
      nextConversation.messages
    );
    const currentThreadMessages = shouldMergeCurrent
      ? filterThreadMessagesForConversation(
          nextConversation.conversationId,
          currentConversation?.messages
        )
      : [];
    const fallbackMessages = filterThreadMessagesForConversation(
      nextConversation.conversationId,
      getFallbackMessages(nextConversation)
    );
    const messageContext = {
      accountId: nextConversation.accountId,
      conversationId: nextConversation.conversationId,
    };
    const mergedMessages = mergeMessages(
      mergeMessages(
        currentThreadMessages,
        nextThreadMessages,
        messageContext,
        `mergeConversationForDisplay:thread:${nextConversation.conversationId}`
      ),
      fallbackMessages,
      messageContext,
      `mergeConversationForDisplay:fallback:${nextConversation.conversationId}`
    );
    const finalMessages = shouldMergeCurrent && currentConversation?.messages &&
      areThreadMessagesEquivalent(currentConversation.messages, mergedMessages)
      ? currentConversation.messages
      : mergedMessages;

    return {
      ...nextConversation,
      messages: finalMessages,
      lastMessage: pickLatestLastMessage(
        shouldMergeCurrent ? currentConversation?.lastMessage : undefined,
        nextConversation.lastMessage,
        finalMessages
      ),
    };
  }, [getFallbackMessages]);

  const loadAccounts = useCallback(async () => {
    try {
      const { accounts: nextAccounts } = await getAccounts();
      setAccounts(nextAccounts);
    } catch {
      // Non-fatal. Inbox still works without account filters.
    }
  }, []);

  const loadInbox = useCallback(async (requestedLimit?: number): Promise<Conversation[]> => {
    try {
      const effectiveLimit = requestedLimit ?? visibleLimitRef.current;
      const inboxData = await getUnifiedInbox(effectiveLimit);
      setConversations(inboxData.conversations);
      const activeKey = activeConversationKeyRef.current;
      const freshConversation = findConversationBySelectionKey(inboxData.conversations, activeKey);

      if (activeKey && !freshConversation) {
        setSelected(null);
        setActiveConversationKey(null);
        setIsThreadLoading(false);
      } else {
        setSelected((currentSelected) => {
          if (!activeKey || !freshConversation) {
            return currentSelected;
          }

          const currentSelectionMatches = getConversationSelectionKey(currentSelected) === activeKey;
          if (!currentSelectionMatches) {
            return currentSelected;
          }

          if (isThreadLoadingRef.current) {
            return {
              ...currentSelected!,
              unreadCount: freshConversation.unreadCount,
              lastMessage: freshConversation.lastMessage,
              participant: freshConversation.participant,
            };
          }

          return {
            ...currentSelected!,
            unreadCount: freshConversation.unreadCount,
            lastMessage: freshConversation.lastMessage,
            participant: freshConversation.participant,
          };
        });
      }
      setError(null);
      return inboxData.conversations;
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.status === 429) {
        const retryAfterSec = nextError.retryAfterSec ?? DEFAULT_RELOAD_BACKOFF_SEC;
        setReloadCooldownUntil(Date.now() + (retryAfterSec * 1000));
        setCooldownClock(Date.now());
      }
      setError(nextError instanceof Error ? nextError.message : 'Failed to load inbox');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const loadConversationThread = useCallback(async (
    conversation: Conversation,
    options: { mode: 'switch' | 'passive' }
  ) => {
    const conversationKey = getConversationSelectionKey(conversation);
    const isConversationChange = activeConversationKeyRef.current !== conversationKey;
    const requestToken = threadRequestTokenRef.current + 1;
    threadRequestTokenRef.current = requestToken;

    if (isConversationChange) {
      setActiveConversationKey(conversationKey);
      setIsThreadLoading(true);
      const initialConversation = { ...conversation, messages: [] };
      logMessageArray(`handleSelect before thread fetch ${conversation.conversationId}`, initialConversation.messages);
      logThreadDiagnostics(`before thread fetch ${conversation.conversationId}`, initialConversation);
      setSelected(initialConversation);
    } else {
      setSelected((existingConversation) => {
        if (getConversationSelectionKey(existingConversation) !== conversationKey || !existingConversation) {
          return existingConversation;
        }

        return {
          ...existingConversation,
          unreadCount: conversation.unreadCount,
          lastMessage: conversation.lastMessage,
          participant: conversation.participant,
        };
      });
    }

    try {
      const thread = await getConversationThread(conversation.accountId, conversation.conversationId, {
        refresh: true,
        limit: 250,
      });
      const hasThreadMessages = Array.isArray(thread.messages) && thread.messages.length > 0;
      if (!shouldApplyThreadResponse(
        threadRequestTokenRef.current,
        requestToken,
        activeConversationKeyRef.current,
        conversationKey
      )) {
        return;
      }

      setSelected((currentSelected) => {
        const baselineConversation = areSameConversation(currentSelected, conversation)
          ? currentSelected
          : { ...conversation, messages: [] };
        const nextMessages = hasThreadMessages
          ? thread.messages
          : baselineConversation?.messages?.length
            ? baselineConversation.messages
            : getFallbackMessages(conversation);
        const mergedConversation = mergeConversationForDisplay(baselineConversation, {
          ...conversation,
          messages: nextMessages,
        });
        logMessageArray(`handleSelect after thread fetch ${conversation.conversationId}`, mergedConversation.messages);
        logThreadDiagnostics(`after thread fetch ${conversation.conversationId}`, mergedConversation);
        return mergedConversation;
      });
    } catch {
      if (!shouldApplyThreadResponse(
        threadRequestTokenRef.current,
        requestToken,
        activeConversationKeyRef.current,
        conversationKey
      )) {
        return;
      }

      if (options.mode === 'switch') {
        setSelected((nextSelected) => {
          const baselineConversation = areSameConversation(nextSelected, conversation)
            ? nextSelected
            : { ...conversation, messages: [] };
          const mergedConversation = mergeConversationForDisplay(baselineConversation, {
            ...conversation,
            messages: baselineConversation?.messages?.length
              ? baselineConversation.messages
              : getFallbackMessages(conversation),
          });
          logMessageArray(`handleSelect fallback ${conversation.conversationId}`, mergedConversation.messages);
          logThreadDiagnostics(`fallback thread state ${conversation.conversationId}`, mergedConversation);
          return mergedConversation;
        });
      }
    } finally {
      if (shouldApplyThreadResponse(
        threadRequestTokenRef.current,
        requestToken,
        activeConversationKeyRef.current,
        conversationKey
      )) {
        setIsThreadLoading(false);
      }
    }
  }, [getFallbackMessages, mergeConversationForDisplay]);

  const handleSelect = useCallback(async (conversation: Conversation) => {
    await loadConversationThread(conversation, { mode: 'switch' });
  }, [loadConversationThread]);

  const refreshSelectedConversation = useCallback(async (nextConversations: Conversation[]) => {
    const activeKey = activeConversationKeyRef.current;
    if (!activeKey) {
      return;
    }

    const refreshedConversation = findConversationBySelectionKey(nextConversations, activeKey);
    if (!refreshedConversation) {
      setSelected(null);
      setActiveConversationKey(null);
      setIsThreadLoading(false);
      return;
    }

    await loadConversationThread(refreshedConversation, { mode: 'passive' });
  }, [loadConversationThread]);

  useEffect(() => {
    const unsubscribeInboxUpdate = wsClient.on('inbox:updated', () => {
      console.debug('[Inbox][WS] inbox:updated received');
      void (async () => {
        const nextConversations = await loadInbox();
        await refreshSelectedConversation(nextConversations);
      })();
    });

    const unsubscribeNewMessage = wsClient.on('inbox:new_message', (data: InboxNewMessagePayload) => {
      const currentSelected = selectedRef.current;
      console.debug(
        `[Inbox][WS] inbox:new_message incomingChatId=${String(data.chatId || '')} selectedChatId=${String(currentSelected?.conversationId || '')}`
      );
      if (currentSelected && data.chatId === currentSelected.conversationId) {
        void loadConversationThread(currentSelected, { mode: 'passive' });
      } else {
        void (async () => {
          const nextConversations = await loadInbox();
          await refreshSelectedConversation(nextConversations);
        })();
      }
    });

    const unsubscribeStatus = wsClient.on('status:changed', (data: StatusChangedPayload) => {
      setWsStatus(data.status ?? 'disconnected');
    });

    setWsStatus(wsClient.isConnected ? 'connected' : 'disconnected');

    return () => {
      unsubscribeInboxUpdate();
      unsubscribeNewMessage();
      unsubscribeStatus();
    };
  }, [loadConversationThread, loadInbox, refreshSelectedConversation]);

  const filteredConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return conversations.filter((conversation) => {
      const matchesFilter = filter === 'all' || conversation.accountId === filter;
      if (!matchesFilter) return false;

      if (!normalizedSearch) return true;

      const haystack = [
        conversation.participant.name,
        conversation.participant.profileUrl,
        conversation.lastMessage.text,
        accountLabelById[conversation.accountId] ?? conversation.accountId,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [accountLabelById, conversations, filter, search]);

  const isLive = wsStatus === 'connected';
  const connectionUiStatus: 'connected' | 'disconnected' | 'reconnecting' = !isLive && !showConnectionStatus
    ? 'connected'
    : wsStatus;
  const showReconnectAction = connectionUiStatus === 'disconnected';
  const canLoadMore = conversations.length >= visibleLimit;
  const reloadCooldownRemainingSec = Math.max(
    0,
    Math.ceil((reloadCooldownUntil - cooldownClock) / 1000)
  );
  const liveTooltip = connectionUiStatus === 'connected'
    ? 'Live means real-time inbox updates are connected. New messages should appear automatically.'
    : connectionUiStatus === 'reconnecting'
      ? 'The real-time connection is retrying. You can reconnect or reload the inbox manually.'
      : 'Offline means live updates are paused. Reconnect or reload the inbox to refresh conversations.';

  useEffect(() => {
    if (!isLive || accounts.length === 0) return;

    const ids = Array.from(new Set(accounts.map((account) => String(account.id || '').trim()).filter(Boolean)));
    ids.forEach((id) => wsClient.joinAccountRoom(id));

    return () => {
      ids.forEach((id) => wsClient.leaveAccountRoom(id));
    };
  }, [accounts, isLive]);

  const handleLoadMore = useCallback(async () => {
    const nextLimit = visibleLimitRef.current + 25;
    setIsLoadingMore(true);
    setVisibleLimit(nextLimit);

    try {
      await loadInbox(nextLimit);
    } finally {
      setIsLoadingMore(false);
    }
  }, [loadInbox]);

  const handleReconnect = useCallback(async () => {
    wsClient.reconnect();
    await loadInbox();
  }, [loadInbox]);

  const handleBackToList = useCallback(() => {
    threadRequestTokenRef.current += 1;
    setIsThreadLoading(false);
    setActiveConversationKey(null);
    setSelected(null);
  }, []);

  const handleReloadInbox = useCallback(async () => {
    if (reloadCooldownUntil > Date.now()) {
      toast(`Please wait ${Math.max(1, Math.ceil((reloadCooldownUntil - Date.now()) / 1000))}s before syncing again.`, {
        icon: 'i',
      });
      return;
    }

    const scopedAccountId = selectedRef.current?.accountId || (filter !== 'all' ? filter : undefined);
    console.debug(`[Inbox] Sync & Reload requested accountId=${String(scopedAccountId || '')}`);
    if (!scopedAccountId) {
      await loadInbox();
      return;
    }

    syncInFlightRef.current = true;
    setIsReloadingInbox(true);

    try {
      const syncResult = await syncMessages(scopedAccountId);
      console.debug(
        `[Inbox] Sync & Reload completed accountId=${scopedAccountId} message=${syncResult?.message || ''} stats=${JSON.stringify(syncResult?.stats || null)}`
      );
      const nextConversations = await loadInbox();
      console.debug(`[Inbox] Reloaded unified inbox after sync accountId=${scopedAccountId} conversations=${nextConversations.length}`);
      await refreshSelectedConversation(nextConversations);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Failed to sync inbox';
      console.warn(`[Inbox] Sync & Reload failed accountId=${scopedAccountId}: ${message}`);
      if (nextError instanceof ApiError && nextError.status === 429) {
        const retryAfterSec = nextError.retryAfterSec ?? DEFAULT_RELOAD_BACKOFF_SEC;
        setReloadCooldownUntil(Date.now() + (retryAfterSec * 1000));
        setCooldownClock(Date.now());
      }
      toast.error(message);
      const nextConversations = await loadInbox();
      console.debug(`[Inbox] Reloaded unified inbox after failed sync accountId=${scopedAccountId} conversations=${nextConversations.length}`);
      await refreshSelectedConversation(nextConversations);
    } finally {
      syncInFlightRef.current = false;
      setIsReloadingInbox(false);
    }
  }, [filter, loadInbox, refreshSelectedConversation, reloadCooldownUntil]);

  useEffect(() => {
    const syncWhenVisible = () => {
      if (typeof document === 'undefined') {
        return;
      }

      if (document.visibilityState !== 'visible') {
        return;
      }

      if (syncInFlightRef.current) {
        return;
      }

      const scopedAccountId = selectedRef.current?.accountId || (filter !== 'all' ? filter : undefined);
      if (!scopedAccountId) {
        return;
      }

      void handleReloadInbox();
    };

    const intervalId = window.setInterval(syncWhenVisible, 60_000);
    document.addEventListener('visibilitychange', syncWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', syncWhenVisible);
    };
  }, [filter, handleReloadInbox]);

  if (loading) {
    return (
      <div className="inbox-page-shell flex h-full min-h-0 flex-1 overflow-hidden px-6 pb-6 pt-4 max-[900px]:block max-[900px]:px-0 max-[900px]:pb-0">
        <div className="inbox-main-card flex h-full min-h-0 w-full overflow-hidden rounded-[28px] border max-[900px]:rounded-none max-[900px]:border-x-0 max-[900px]:border-b-0">
          <div
            className="min-w-[340px] max-w-[360px] flex-[0_0_340px] border-r max-[1200px]:min-w-[320px] max-[1200px]:flex-[0_0_320px] max-[900px]:w-full max-[900px]:min-w-0 max-[900px]:max-w-none max-[900px]:border-r-0"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-elevated, var(--bg-panel))' }}
          >
            <ConversationListSkeleton count={8} />
          </div>
          <div className="flex min-w-0 flex-1 items-stretch overflow-hidden max-[900px]:hidden" style={{ backgroundColor: 'var(--surface-elevated, #ffffff)' }}>
            <div className="min-h-0 w-full p-6">
              <MessageThreadSkeleton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadInbox} />;
  }

  return (
    <div className="inbox-page-shell flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-6 py-4 max-[900px]:px-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between gap-4 max-[700px]:flex-col max-[700px]:items-stretch">
          <div>
            <h1 className="text-[1.5rem] font-semibold tracking-tight" style={{ color: 'var(--text-primary-new, var(--text-primary))' }}>
              Inbox
            </h1>
            <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-muted-new, var(--text-muted))' }}>
              Review conversations, reply clearly, and stay in sync without leaving the thread view.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              className="inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-xs"
              title={liveTooltip}
              role="status"
              aria-live="polite"
              aria-label={`Live updates status: ${connectionUiStatus === 'connected' ? 'connected' : connectionUiStatus === 'reconnecting' ? 'reconnecting' : 'offline'}`}
              style={{
                backgroundColor: connectionUiStatus === 'connected' ? 'rgba(16, 185, 129, 0.12)' : connectionUiStatus === 'reconnecting' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(148, 163, 184, 0.12)',
                color: connectionUiStatus === 'connected' ? '#047857' : connectionUiStatus === 'reconnecting' ? '#b45309' : 'var(--text-muted-new, var(--text-muted))',
              }}
            >
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: connectionUiStatus === 'connected' ? '#10b981' : connectionUiStatus === 'reconnecting' ? '#f59e0b' : '#94a3b8',
                  boxShadow: connectionUiStatus === 'connected' ? '0 0 10px rgba(16, 185, 129, 0.55)' : 'none',
                }}
              />
              <span className="font-medium">
                {connectionUiStatus === 'connected' ? 'Live updates on' : connectionUiStatus === 'reconnecting' ? 'Reconnecting...' : 'Live updates paused'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleReloadInbox()}
              disabled={isReloadingInbox || reloadCooldownRemainingSec > 0}
              className="button-outline inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-xs font-medium"
            >
              <RefreshCw size={14} className={isReloadingInbox ? 'animate-spin' : ''} />
              {isReloadingInbox
                ? 'Syncing...'
                : reloadCooldownRemainingSec > 0
                  ? `Retry in ${reloadCooldownRemainingSec}s`
                  : 'Sync'}
            </button>
            {showReconnectAction && (
              <button
                type="button"
                onClick={() => void handleReconnect()}
                className="button-outline rounded-full px-2.5 py-1.5 text-xs font-medium"
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 pb-6 pt-4 max-[900px]:px-0 max-[900px]:pb-0">
        <div className="inbox-main-card flex h-full min-h-0 overflow-hidden rounded-[28px] border max-[900px]:block max-[900px]:rounded-none max-[900px]:border-x-0 max-[900px]:border-b-0" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-elevated, #ffffff)' }}>
          <div className={`${selected ? 'h-full max-[900px]:hidden' : 'h-full'} min-w-[340px] max-w-[360px] flex-[0_0_340px] overflow-hidden border-r max-[1200px]:min-w-[320px] max-[1200px]:flex-[0_0_320px] max-[900px]:w-full max-[900px]:min-w-0 max-[900px]:max-w-none max-[900px]:border-r-0`} style={{ borderColor: 'var(--border)' }}>
            <ConversationList
              conversations={filteredConversations}
              accounts={accounts}
              accountLabels={accountLabelById}
              selectedConversationKey={activeConversationKey}
              filter={filter}
              search={search}
              canLoadMore={canLoadMore}
              isLoadingMore={isLoadingMore}
              onFilterChange={setFilter}
              onSearchChange={setSearch}
              onLoadMore={() => void handleLoadMore()}
              onSelect={handleSelect}
            />
          </div>
          <div className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${selected ? 'max-[900px]:flex' : 'max-[900px]:hidden'}`}>
            <MessageThread
              key={activeConversationKey ?? 'empty-thread'}
              conversation={selected}
              isLoadingConversation={isThreadLoading}
              accountLabelById={accountLabelById}
              onSyncAfterSend={handleReloadInbox}
              onBack={selected ? handleBackToList : undefined}
              onMessageSent={(updatedConversation) => {
                setConversations((currentConversations) =>
                  currentConversations.map((conversation) => {
                    if (!areSameConversation(conversation, updatedConversation)) {
                      return conversation;
                    }

                    logMessageArray(`before onMessageSent list update ${conversation.conversationId}`, conversation.messages);
                    const mergedConversation = mergeConversationForDisplay(conversation, updatedConversation);
                    logMessageArray(`after onMessageSent list update ${mergedConversation.conversationId}`, mergedConversation.messages);
                    return mergedConversation;
                  })
                );
                setSelected((currentSelected) => {
                  const mergedConversation = mergeConversationForDisplay(currentSelected, updatedConversation);
                  logMessageArray(`after onMessageSent selected update ${mergedConversation.conversationId}`, mergedConversation.messages);
                  return mergedConversation;
                });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}



