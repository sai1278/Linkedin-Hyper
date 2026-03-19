'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Conversation, Account } from '@/types/dashboard';
import { getUnifiedInbox, getAccounts, getConversationThread } from '@/lib/api-client';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';

export default function InboxPage() {
  const [accounts,      setAccounts]      = useState<Account[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected,      setSelected]      = useState<Conversation | null>(null);
  const [filter,        setFilter]        = useState<string>('all');
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);

  // B2 — Accounts are stable; fetch once on mount (5-min ISR cache in api-client).
  const loadAccounts = useCallback(async () => {
    try {
      const { accounts: accs } = await getAccounts();
      setAccounts(accs);
    } catch {
      // non-fatal — account list stays empty, filter pills just won't show
    }
  }, []);

  // B2 — Inbox is real-time; poll separately on its own interval.
  const loadInbox = useCallback(async () => {
    try {
      const inboxData = await getUnifiedInbox();
      setConversations(inboxData.conversations);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inbox');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts(); // once on mount
  }, [loadAccounts]);

  useEffect(() => {
    void loadInbox();
    // Silent background refresh every 120 s — does NOT reset loading state
    const interval = setInterval(() => void loadInbox(), 120_000);
    return () => clearInterval(interval);
  }, [loadInbox]);

  const filtered =
    filter === 'all'
      ? conversations
      : conversations.filter((c) => c.accountId === filter);

  async function handleSelect(conv: Conversation) {
    setSelected(conv); // immediate optimistic UI update
    try {
      const thread = await getConversationThread(conv.accountId, conv.conversationId);
      setSelected({ ...conv, messages: thread.messages });
    } catch {
      // ignore — thread shows with previous messages or empty
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 h-full">
        <Spinner size="lg" />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Fetching messages from all accounts…
        </p>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadInbox} />;
  }

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={filtered}
        accounts={accounts}
        selected={selected}
        filter={filter}
        onFilterChange={setFilter}
        onSelect={handleSelect}
      />
      <MessageThread
        conversation={selected}
        onMessageSent={(updatedConv) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.conversationId === updatedConv.conversationId ? updatedConv : c
            )
          );
          setSelected(updatedConv);
        }}
      />
    </div>
  );
}
