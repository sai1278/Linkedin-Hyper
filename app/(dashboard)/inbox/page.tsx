'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import type { Account, Conversation, Message } from '@/types/dashboard';
import { getAccounts, getConversationThread, getUnifiedInbox, syncMessages } from '@/lib/api-client';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { ConversationListSkeleton, MessageThreadSkeleton } from '@/components/ui/SkeletonLoader';
import { ErrorState } from '@/components/ui/ErrorState';
import { wsClient } from '@/lib/websocket-client';
import { ExportButton } from '@/components/ui/ExportButton';
import { DASHBOARD_ROUTE_META } from '@/lib/dashboard-route-meta';
import { getAccountLabel } from '@/lib/account-label';
import toast from 'react-hot-toast';

type InboxUpdatedPayload = {
  conversations?: Conversation[];
};

type InboxNewMessagePayload = {
  chatId?: string;
};

type StatusChangedPayload = {
  status?: 'connected' | 'disconnected' | 'reconnecting';
};

function isPreviewConversationId(conversationId: string): boolean {
  return conversationId.startsWith('activity-') || conversationId.startsWith('fallback-');
}

function normalizeConversationValue(value: string | undefined | null): string {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function findMatchingConversation(
  currentSelected: Conversation,
  nextConversations: Conversation[]
): Conversation | null {
  const directMatch = nextConversations.find(
    (conversation) => conversation.conversationId === currentSelected.conversationId
  );
  if (directMatch) {
    return directMatch;
  }

  const selectedProfileUrl = normalizeConversationValue(currentSelected.participant.profileUrl);
  if (selectedProfileUrl) {
    const profileMatch = nextConversations.find((conversation) => (
      conversation.accountId === currentSelected.accountId &&
      normalizeConversationValue(conversation.participant.profileUrl) === selectedProfileUrl
    ));
    if (profileMatch) {
      return profileMatch;
    }
  }

  const selectedName = normalizeConversationValue(currentSelected.participant.name);
  if (!selectedName) {
    return null;
  }

  return nextConversations.find((conversation) => (
    conversation.accountId === currentSelected.accountId &&
    normalizeConversationValue(conversation.participant.name) === selectedName
  )) || null;
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

function getMessageTimestamp(message: Message | undefined | null): number {
  return Number(message?.sentAt) || 0;
}

function areEquivalentMessages(left: Message, right: Message): boolean {
  const leftId = String(left.id || '').trim();
  const rightId = String(right.id || '').trim();
  if (leftId && rightId && leftId === rightId) {
    return true;
  }

  return (
    left.sentByMe === right.sentByMe &&
    normalizeMessageText(left.senderName) === normalizeMessageText(right.senderName) &&
    normalizeMessageText(left.text) === normalizeMessageText(right.text) &&
    Math.abs(getMessageTimestamp(left) - getMessageTimestamp(right)) <= 2 * 60 * 1000
  );
}

function scoreMessage(message: Message): number {
  const rawId = String(message.id || '');
  let score = 0;

  if (message.status === 'sent' || (!message.sentByMe && !message.status)) score += 40;
  if (message.status === 'sending') score += 20;
  if (message.status === 'failed') score += 10;
  if (message.error == null) score += 5;
  if (rawId && !rawId.startsWith('opt-') && !rawId.startsWith('preview-') && !rawId.startsWith('live-')) score += 5;
  if (normalizeMessageText(message.senderName)) score += 2;
  if (normalizeMessageText(message.text)) score += 2;

  return score;
}

function preferMessage(existing: Message, candidate: Message): Message {
  const preferred = scoreMessage(candidate) >= scoreMessage(existing) ? candidate : existing;
  const secondary = preferred === candidate ? existing : candidate;

  return {
    ...secondary,
    ...preferred,
    id: preferred.id || secondary.id,
    text: preferred.text || secondary.text,
    sentAt: getMessageTimestamp(preferred) || getMessageTimestamp(secondary),
    sentByMe: preferred.sentByMe ?? secondary.sentByMe,
    senderName: preferred.senderName || secondary.senderName,
    status: preferred.status ?? secondary.status,
    error: preferred.error ?? secondary.error ?? null,
  };
}

function mergeMessageHistory(...messageSets: Array<Message[] | undefined | null>): Message[] {
  const merged: Message[] = [];

  for (const message of messageSets.flatMap((set) => set || [])) {
    if (!message) continue;

    const existingIndex = merged.findIndex((current) => areEquivalentMessages(current, message));
    if (existingIndex >= 0) {
      merged[existingIndex] = preferMessage(merged[existingIndex], message);
      continue;
    }

    merged.push({
      ...message,
      text: message.text || '',
      senderName: message.senderName || 'Unknown',
      error: message.error ?? null,
    });
  }

  return merged.sort((left, right) => {
    const sentAtDiff = getMessageTimestamp(left) - getMessageTimestamp(right);
    if (sentAtDiff !== 0) {
      return sentAtDiff;
    }

    return normalizeMessageText(left.text).localeCompare(normalizeMessageText(right.text));
  });
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
  })));
}

export default function InboxPage() {
  const routeMeta = DASHBOARD_ROUTE_META.inbox;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(25);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isReloadingInbox, setIsReloadingInbox] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>(
    wsClient.isConnected ? 'connected' : 'disconnected'
  );
  const selectedRef = useRef<Conversation | null>(null);
  const visibleLimitRef = useRef(25);
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    visibleLimitRef.current = visibleLimit;
  }, [visibleLimit]);

  const accountLabelById = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, getAccountLabel(account)])),
    [accounts]
  );

  const getFallbackMessages = useCallback((conversation: Conversation): Message[] => {
    if (Array.isArray(conversation.messages) && conversation.messages.length > 0) {
      return conversation.messages;
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
    const fallbackMessages = getFallbackMessages(nextConversation);
    const mergedMessages = mergeMessageHistory(
      shouldMergeCurrent ? currentConversation?.messages : [],
      nextConversation.messages,
      fallbackMessages
    );

    return {
      ...nextConversation,
      messages: mergedMessages,
      lastMessage: pickLatestLastMessage(
        shouldMergeCurrent ? currentConversation?.lastMessage : undefined,
        nextConversation.lastMessage,
        mergedMessages
      ),
    };
  }, [getFallbackMessages]);

  const mergePreviewConversationMessages = useCallback((
    currentSelected: Conversation,
    freshConversation: Conversation
  ): Message[] => {
    return mergeMessageHistory(
      currentSelected.messages,
      freshConversation.messages,
      getFallbackMessages(freshConversation)
    );
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
      setSelected((currentSelected) => {
        if (!currentSelected) return currentSelected;

        const freshConversation = findMatchingConversation(currentSelected, inboxData.conversations);

        if (!freshConversation) return currentSelected;

        const mergedConversation = mergeConversationForDisplay(currentSelected, {
          ...freshConversation,
          messages: mergePreviewConversationMessages(currentSelected, freshConversation),
        });
        logMessageArray(`loadInbox merged selected ${mergedConversation.conversationId}`, mergedConversation.messages);
        return mergedConversation;
      });
      setError(null);
      return inboxData.conversations;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load inbox');
      return [];
    } finally {
      setLoading(false);
    }
  }, [mergeConversationForDisplay, mergePreviewConversationMessages]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const handleSelect = useCallback(async (conversation: Conversation) => {
    const initialConversation = mergeConversationForDisplay(selectedRef.current, {
      ...conversation,
      messages: getFallbackMessages(conversation),
    });
    logMessageArray(`handleSelect before thread fetch ${conversation.conversationId}`, initialConversation.messages);
    setSelected(initialConversation);

    try {
      const thread = await getConversationThread(conversation.accountId, conversation.conversationId, {
        refresh: true,
      });
      const hasThreadMessages = Array.isArray(thread.messages) && thread.messages.length > 0;
      setSelected((currentSelected) => {
        const baselineConversation = areSameConversation(currentSelected, conversation)
          ? currentSelected
          : initialConversation;
        const mergedConversation = mergeConversationForDisplay(baselineConversation, {
          ...conversation,
          messages: hasThreadMessages ? thread.messages : getFallbackMessages(conversation),
        });
        logMessageArray(`handleSelect after thread fetch ${conversation.conversationId}`, mergedConversation.messages);
        return mergedConversation;
      });
    } catch {
      setSelected((currentSelected) => {
        const baselineConversation = areSameConversation(currentSelected, conversation)
          ? currentSelected
          : initialConversation;
        const mergedConversation = mergeConversationForDisplay(baselineConversation, {
          ...conversation,
          messages: getFallbackMessages(conversation),
        });
        logMessageArray(`handleSelect fallback ${conversation.conversationId}`, mergedConversation.messages);
        return mergedConversation;
      });
    }
  }, [getFallbackMessages, mergeConversationForDisplay]);

  const refreshSelectedConversation = useCallback(async (nextConversations: Conversation[]) => {
    const currentSelected = selectedRef.current;
    if (!currentSelected) {
      return;
    }

    const refreshedConversation = findMatchingConversation(currentSelected, nextConversations);
    if (!refreshedConversation) {
      return;
    }

    await handleSelect(refreshedConversation);
  }, [handleSelect]);

  useEffect(() => {
    const unsubscribeInboxUpdate = wsClient.on('inbox:updated', (_data: InboxUpdatedPayload) => {
      void (async () => {
        const nextConversations = await loadInbox();
        await refreshSelectedConversation(nextConversations);
      })();
    });

    const unsubscribeNewMessage = wsClient.on('inbox:new_message', (data: InboxNewMessagePayload) => {
      const currentSelected = selectedRef.current;
      if (currentSelected && data.chatId === currentSelected.conversationId) {
        void handleSelect(currentSelected);
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
  }, [handleSelect, loadInbox, refreshSelectedConversation]);

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
  const canLoadMore = conversations.length >= visibleLimit;
  const liveTooltip = wsStatus === 'connected'
    ? 'Live means real-time inbox updates are connected. New messages should appear automatically.'
    : wsStatus === 'reconnecting'
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

  const handleReloadInbox = useCallback(async () => {
    const scopedAccountId = selectedRef.current?.accountId || (filter !== 'all' ? filter : undefined);
    if (!scopedAccountId) {
      await loadInbox();
      return;
    }

    syncInFlightRef.current = true;
    setIsReloadingInbox(true);

    try {
      await syncMessages(scopedAccountId);
      const nextConversations = await loadInbox();
      await refreshSelectedConversation(nextConversations);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Failed to sync inbox';
      toast.error(message);
      const nextConversations = await loadInbox();
      await refreshSelectedConversation(nextConversations);
    } finally {
      syncInFlightRef.current = false;
      setIsReloadingInbox(false);
    }
  }, [filter, loadInbox, refreshSelectedConversation]);

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
      <div className="flex h-full flex-1 overflow-hidden max-[900px]:block">
        <div
          className="w-[360px] flex-shrink-0 border-r max-[900px]:w-full max-[900px]:border-r-0"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary, var(--bg-panel))' }}
        >
          <ConversationListSkeleton count={8} />
        </div>
        <div className="flex flex-1 items-stretch max-[900px]:hidden" style={{ backgroundColor: 'var(--bg-secondary, #ffffff)' }}>
          <div className="w-full p-6">
            <MessageThreadSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadInbox} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {routeMeta.pageTitle}
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {routeMeta.description}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-2"
            title={liveTooltip}
            role="status"
            aria-live="polite"
            aria-label={`Live updates status: ${isLive ? 'connected' : wsStatus === 'reconnecting' ? 'reconnecting' : 'offline'}`}
          >
            <div
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: isLive ? '#10b981' : wsStatus === 'reconnecting' ? '#f59e0b' : '#6b7280',
                boxShadow: isLive ? '0 0 8px rgba(16, 185, 129, 0.6)' : 'none',
              }}
            />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {isLive ? 'Live' : wsStatus === 'reconnecting' ? 'Reconnecting' : 'Offline'}
            </span>
          </div>

          <ExportButton
            type="messages"
            accountId={filter !== 'all' ? filter : undefined}
            label="Export"
            size="sm"
          />
        </div>
      </div>

      {!isLive && (
        <div
          className="mx-6 mt-4 flex items-start justify-between gap-4 rounded-2xl border px-4 py-3 shadow-sm"
          style={{
            backgroundColor: wsStatus === 'reconnecting' ? '#fff7ed' : '#fef2f2',
            borderColor: wsStatus === 'reconnecting' ? '#fdba74' : '#fca5a5',
          }}
        >
          <div className="flex items-start gap-3">
            <WifiOff size={18} style={{ color: wsStatus === 'reconnecting' ? '#c2410c' : '#b91c1c' }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {wsStatus === 'reconnecting'
                  ? 'Real-time inbox is reconnecting'
                  : 'Real-time inbox is offline'}
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {wsStatus === 'reconnecting'
                  ? 'New events may be delayed for a moment. You can reconnect or refresh manually.'
                  : 'Live updates are paused. Reconnect the socket or reload the inbox to catch up.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleReconnect()}
              className="button-primary rounded-xl px-3 py-2 text-sm font-medium"
            >
              Reconnect
            </button>
            <button
              type="button"
              onClick={() => void handleReloadInbox()}
              disabled={isReloadingInbox}
              className="button-outline inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium"
            >
              <RefreshCw size={14} className={isReloadingInbox ? 'animate-spin' : ''} />
              {isReloadingInbox ? 'Syncing inbox...' : 'Sync & Reload inbox'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden max-[900px]:block">
        <div className={selected ? 'h-full max-[900px]:hidden' : 'h-full'}>
          <ConversationList
            conversations={filteredConversations}
            accounts={accounts}
            accountLabels={accountLabelById}
            selected={selected}
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
        <div className={`flex flex-1 overflow-hidden ${selected ? 'max-[900px]:flex' : 'max-[900px]:hidden'}`}>
          <MessageThread
            conversation={selected}
            accountLabelById={accountLabelById}
            onSyncAfterSend={handleReloadInbox}
            onBack={selected ? () => setSelected(null) : undefined}
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
  );
}
