import type { Account, Conversation, ActivityEntry } from '@/types/dashboard';

const BASE = '/api/proxy';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export async function getAccounts(): Promise<{ accounts: Account[] }> {
  return apiFetch<{ accounts: Account[] }>('accounts');
}

// ── Unified Inbox ─────────────────────────────────────────────────────────────

export async function getUnifiedInbox(): Promise<{ conversations: Conversation[] }> {
  return apiFetch<{ conversations: Conversation[] }>('inbox/unified');
}

export async function getConversationThread(
  accountId: string,
  chatId: string
): Promise<{ messages: Message[] }> {
  const res = await apiFetch<{
    items: Array<{
      id: string;
      chatId: string;
      senderId: string;
      text: string;
      createdAt: string;
    }>;
  }>(`messages/thread?accountId=${encodeURIComponent(accountId)}&chatId=${encodeURIComponent(chatId)}`);

  return {
    messages: res.items.map((m) => ({
      id: m.id,
      text: m.text,
      sentAt: new Date(m.createdAt).getTime(),
      sentByMe: m.senderId === '__self__',
      senderName: m.senderId === '__self__' ? accountId : 'Participant',
    })),
  };
}

// ── Activity Log ──────────────────────────────────────────────────────────────

export async function getAccountActivity(
  accountId: string,
  page = 0,
  limit = 50
): Promise<{ entries: ActivityEntry[]; total: number }> {
  return apiFetch<{ entries: ActivityEntry[]; total: number }>(
    `stats/${encodeURIComponent(accountId)}/activity?page=${page}&limit=${limit}`
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getAllAccountsSummary(): Promise<{
  accounts: Record<string, { id: string; totalActivity: number }>;
  totalMessages: number;
  totalConnections: number;
}> {
  return apiFetch('stats/all/summary');
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function sendMessage(
  accountId: string,
  chatId: string,
  text: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('messages/send', {
    method: 'POST',
    body: JSON.stringify({ accountId, chatId, text }),
  });
}
