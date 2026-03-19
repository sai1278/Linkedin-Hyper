import type { Account, Conversation, ActivityEntry, Message } from '@/types/dashboard';

const BASE = '/api';

// B1 — Tiered caching strategy per route:
//  /accounts          → revalidate 300 s (rarely changes)
//  /stats/all/summary → revalidate 60 s
//  /inbox/unified     → no-store  (real-time, Redis cache handles freshness)
//  /messages/thread   → no-store  (real-time)
async function apiFetch<T>(path: string, options?: RequestInit & { ttl?: number }): Promise<T> {
  const { ttl, ...rest } = options ?? {};
  const res = await fetch(`${BASE}/${path}`, {
    cache: ttl ? 'force-cache' : 'no-store',
    // `next` is a Next.js extension of the standard RequestInit.
    // Cast needed because the ambient type may not include it.
    ...(ttl ? { next: { revalidate: ttl } } : {}),
    ...rest,
    headers: { 'Content-Type': 'application/json', ...rest.headers },
  } as RequestInit);

  if (!res.ok) {
    let errorDetail = res.statusText;
    try {
      const errBody = await res.json();
      if (errBody.error) errorDetail = errBody.error;
    } catch {}
    throw new Error(`API ${res.status}: ${errorDetail}`);
  }

  return res.json() as Promise<T>;
}

export async function getAccounts(): Promise<{ accounts: Account[] }> {
  // Accounts rarely change — 5-minute ISR cache avoids a backend hit on every poll tick.
  return apiFetch<{ accounts: Account[] }>('accounts', { ttl: 300 });
}

export async function getUnifiedInbox(): Promise<{ conversations: Conversation[] }> {
  return apiFetch<{ conversations: Conversation[] }>('inbox/unified');
}

export async function getConversationThread(
  accountId: string, chatId: string
): Promise<{ messages: Message[] }> {
  const res = await apiFetch<{
    items: Array<{
      id: string; chatId: string; senderId: string;
      text: string; createdAt: string; senderName?: string;
    }>;
  }>(`messages/thread?accountId=${encodeURIComponent(accountId)}&chatId=${encodeURIComponent(chatId)}`);

  return {
    messages: res.items.map((m) => ({
      id: m.id, text: m.text,
      sentAt:     new Date(m.createdAt).getTime(),
      sentByMe:   m.senderId === '__self__',
      senderName: m.senderId === '__self__' ? (m.senderName || accountId) : (m.senderName || 'Unknown'),
    })),
  };
}

export async function getAccountActivity(
  accountId: string, page = 0, limit = 50
): Promise<{ entries: ActivityEntry[]; total: number }> {
  return apiFetch<{ entries: ActivityEntry[]; total: number }>(
    `stats/${encodeURIComponent(accountId)}/activity?page=${page}&limit=${limit}`
  );
}

export async function getAllAccountsSummary(): Promise<{
  accounts: Record<string, { id: string; totalActivity: number }>;
  totalMessages: number; totalConnections: number;
}> {
  // Stats summary revalidates every 60 s — fast enough to feel current.
  return apiFetch('stats/all/summary', { ttl: 60 });
}

export async function sendMessage(
  accountId: string, chatId: string, text: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('messages/send', {
    method: 'POST',
    body: JSON.stringify({ accountId, chatId, text }),
  });
}

