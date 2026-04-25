import type {
  Account,
  ActivityEntry,
  Connection,
  Conversation,
  HealthSummary,
  Message,
  StartupValidationReport,
} from '@/types/dashboard';
import { deriveDisplayName } from '@/lib/display-name';

const BASE = '/api';
const CLIENT_RETRYABLE_STATUSES = new Set([502, 503, 504]);
const CLIENT_GET_RETRY_COUNT = 2;
const CLIENT_GET_RETRY_DELAY_MS = 400;

export interface AccountSessionStatus {
  exists: boolean;
  savedAt?: number;
  ageSeconds?: number;
}

export interface AccountRateLimits {
  messagesSent?: { current: number; limit: number; resetsAt?: number };
  connectRequests?: { current: number; limit: number; resetsAt?: number };
  searchQueries?: { current: number; limit: number; resetsAt?: number };
}

type ApiFetchOptions = RequestInit & { ttl?: number };

async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const { ttl, ...rest } = options ?? {};
  const method = String(rest.method || 'GET').toUpperCase();
  const isServer = typeof window === 'undefined';
  const res = await fetchWithRetry(`${BASE}/${path}`, {
    cache: isServer && ttl ? 'force-cache' : 'no-store',
    ...(isServer && ttl ? { next: { revalidate: ttl } } : {}),
    ...rest,
    headers: { 'Content-Type': 'application/json', ...rest.headers },
  } as RequestInit, method);

  if (!res.ok) {
    let errorDetail = res.statusText;
    try {
      const errBody = await res.json();
      if (errBody.error) errorDetail = errBody.error;
    } catch {}
    throw new Error(`API ${res.status}: ${errorDetail}`);
  }

  if (res.status === 204 || res.status === 205) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

async function fetchWithRetry(url: string, init: RequestInit, method: string): Promise<Response> {
  const maxRetries = method === 'GET' ? CLIENT_GET_RETRY_COUNT : 0;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (!CLIENT_RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
        return res;
      }

      await res.body?.cancel();
    } catch (error) {
      if (isAbortError(error) || attempt >= maxRetries) {
        throw error;
      }
    }

    await delay(CLIENT_GET_RETRY_DELAY_MS * (attempt + 1));
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getAccounts(options?: RequestInit): Promise<{ accounts: Account[] }> {
  return apiFetch<{ accounts: Account[] }>('accounts', { ttl: 300, ...options });
}

export async function getAccountSessionStatus(accountId: string): Promise<AccountSessionStatus> {
  return apiFetch<AccountSessionStatus>(
    `accounts/${encodeURIComponent(accountId)}/session/status`
  );
}

export async function getAccountLimits(accountId: string): Promise<AccountRateLimits> {
  return apiFetch<AccountRateLimits>(
    `accounts/${encodeURIComponent(accountId)}/limits`
  );
}

export async function verifyAccountSession(accountId: string): Promise<{ ok?: boolean; url?: string; via?: string }> {
  return apiFetch<{ ok?: boolean; url?: string; via?: string }>(
    `accounts/${encodeURIComponent(accountId)}/verify`,
    { method: 'POST' }
  );
}

export async function deleteAccountSession(accountId: string): Promise<void> {
  await apiFetch<void>(`accounts/${encodeURIComponent(accountId)}/session`, {
    method: 'DELETE',
  });
}

export async function syncAllMessages(): Promise<{ success: boolean; message: string }> {
  return apiFetch<{ success: boolean; message: string }>('sync/messages', {
    method: 'POST',
  });
}

export async function syncMessages(accountId?: string): Promise<{ success: boolean; message: string }> {
  return apiFetch<{ success: boolean; message: string }>('sync/messages', {
    method: 'POST',
    body: accountId ? JSON.stringify({ accountId }) : undefined,
  });
}

export async function getUnifiedInbox(limit = 25): Promise<{ conversations: Conversation[] }> {
  const payload = await apiFetch<{ conversations: Conversation[] }>(
    `inbox/unified?limit=${encodeURIComponent(String(limit))}`
  );

  return {
    conversations: payload.conversations.map((conversation) => ({
      ...conversation,
      participant: {
        ...conversation.participant,
        name: deriveDisplayName(conversation.participant?.name || 'Unknown', conversation.participant?.profileUrl || ''),
        avatarUrl: conversation.participant?.avatarUrl || null,
      },
      lastMessage: {
        ...conversation.lastMessage,
        text: conversation.lastMessage?.text || '',
        status: conversation.lastMessage?.status ?? (conversation.lastMessage?.sentByMe ? 'sent' : undefined),
      },
      messages: Array.isArray(conversation.messages)
        ? conversation.messages.map((message) => ({
            ...message,
            status: message.status ?? (message.sentByMe ? 'sent' : undefined),
            error: message.error ?? null,
          }))
        : [],
    })),
  };
}

export async function getConversationThread(
  accountId: string,
  chatId: string,
  options?: { refresh?: boolean }
): Promise<{ messages: Message[] }> {
  const query = new URLSearchParams({
    accountId,
    chatId,
  });
  if (options?.refresh) {
    query.set('refresh', '1');
  }

  const res = await apiFetch<{
    items: Array<{
      id: string;
      chatId: string;
      senderId?: string;
      isSentByMe?: boolean;
      text: string;
      createdAt?: string;
      sentAt?: string;
      senderName?: string;
    }>;
  }>(`messages/thread?${query.toString()}`);

  return {
    messages: res.items.map((message) => ({
      id: message.id,
      text: message.text,
      sentAt: (() => {
        const rawTs = message.createdAt ?? message.sentAt;
        const parsed = rawTs ? new Date(rawTs).getTime() : Date.now();
        return Number.isFinite(parsed) ? parsed : Date.now();
      })(),
      sentByMe: message.senderId === '__self__' || message.isSentByMe === true,
      senderName:
        message.senderId === '__self__' || message.isSentByMe === true
          ? (message.senderName || accountId)
          : (message.senderName || 'Unknown'),
      status: message.senderId === '__self__' || message.isSentByMe === true ? 'sent' : undefined,
      error: null,
    })),
  };
}

export async function getAccountActivity(
  accountId: string,
  page = 0,
  limit = 50
): Promise<{ entries: ActivityEntry[]; total: number }> {
  return apiFetch<{ entries: ActivityEntry[]; total: number }>(
    `stats/${encodeURIComponent(accountId)}/activity?page=${page}&limit=${limit}`
  );
}

export async function getAllAccountsSummary(options?: RequestInit): Promise<{
  accounts: Record<string, { id: string; totalActivity: number }>;
  totalMessages: number;
  totalConnections: number;
  totalActivity: number;
  recentActivity: ActivityEntry[];
}> {
  return apiFetch('stats/all/summary', { ttl: 60, ...options });
}

export async function getHealthSummary(options?: RequestInit): Promise<HealthSummary> {
  return apiFetch<HealthSummary>('health/summary', options);
}

export async function getStartupValidationReport(options?: RequestInit): Promise<StartupValidationReport> {
  return apiFetch<StartupValidationReport>('health/startup-validation', options);
}

export async function getUnifiedConnections(
  limit = 300,
  refresh = false
): Promise<{ connections: Connection[] }> {
  return apiFetch<{ connections: Connection[] }>(
    `connections/unified?limit=${encodeURIComponent(String(limit))}${refresh ? '&refresh=1' : ''}`
  );
}

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

export async function sendMessageNew(
  accountId: string,
  profileUrl: string,
  text: string
): Promise<{
  id?: string;
  chatId?: string;
  senderId?: string;
  text: string;
  createdAt?: string;
  isRead?: boolean;
}> {
  return apiFetch('messages/send-new', {
    method: 'POST',
    body: JSON.stringify({ accountId, profileUrl, text }),
  });
}
