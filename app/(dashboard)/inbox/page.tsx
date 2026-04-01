'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Conversation, Account } from '@/types/dashboard';
import { getUnifiedInbox, getAccounts, getConversationThread } from '@/lib/api-client';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { wsClient } from '@/lib/websocket-client';
import { ExportButton } from '@/components/ui/ExportButton';

type InboxUpdatedPayload = {
  conversations?: Conversation[];
};

type InboxNewMessagePayload = {
  chatId?: string;
};

type StatusChangedPayload = {
  status?: 'connected' | 'disconnected' | 'reconnecting';
};

export default function InboxPage() {
  const [accounts,      setAccounts]      = useState<Account[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected,      setSelected]      = useState<Conversation | null>(null);
  const [filter,        setFilter]        = useState<string>('all');
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [isLive,        setIsLive]        = useState(false);

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
    
    // Set up WebSocket listeners for real-time updates
    const unsubscribeInboxUpdate = wsClient.on('inbox:updated', (data: InboxUpdatedPayload) => {
      console.log('[Inbox] Real-time update received:', data);
      if (data.conversations) {
        setConversations(data.conversations);
      } else {
        // Refresh if update doesn't include full data
        void loadInbox();
      }
    });

    const unsubscribeNewMessage = wsClient.on('inbox:new_message', (data: InboxNewMessagePayload) => {
      console.log('[Inbox] New message received:', data);
      // Refresh the current thread if it's the one receiving the message
      if (selected && data.chatId === selected.conversationId) {
        void handleSelect(selected);
      } else {
        // Refresh inbox to update last message preview
        void loadInbox();
      }
    });

    const unsubscribeStatus = wsClient.on('status:changed', (data: StatusChangedPayload) => {
      setIsLive(data.status === 'connected');
    });

    // Set initial status
    setIsLive(wsClient.isConnected);

    return () => {
      unsubscribeInboxUpdate();
      unsubscribeNewMessage();
      unsubscribeStatus();
    };
  }, [loadInbox, selected]);

  const filtered =
    filter === 'all'
      ? conversations
      : conversations.filter((c) => c.accountId === filter);

  async function handleSelect(conv: Conversation) {
    setSelected(conv); // immediate optimistic UI update
    try {
      const thread = await getConversationThread(conv.accountId, conv.conversationId);
      const fallbackMessages = Array.isArray(conv.messages) ? conv.messages : [];
      const hasThreadMessages = Array.isArray(thread.messages) && thread.messages.length > 0;
      setSelected({
        ...conv,
        messages: hasThreadMessages ? thread.messages : fallbackMessages,
      });
    } catch {
      // ignore — thread shows with previous messages or empty
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 h-full">
        <Spinner size="lg" />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Fetching messages from all accounts...
        </p>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadInbox} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with live indicator */}
      <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Inbox
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full" 
              style={{ 
                backgroundColor: isLive ? '#10b981' : '#6b7280',
                boxShadow: isLive ? '0 0 8px rgba(16, 185, 129, 0.6)' : 'none',
              }}
            />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {isLive ? 'Live' : 'Offline'}
            </span>
          </div>
          
          {/* Export button */}
          <ExportButton 
            type="messages" 
            accountId={filter !== 'all' ? filter : undefined}
            label="Export"
            size="sm"
          />
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
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
    </div>
  );
}
