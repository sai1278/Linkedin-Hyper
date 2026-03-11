/**
 * WorkerClient — HTTP client for the self-hosted Playwright worker API.
 * Talks to WORKER_API_URL (default http://localhost:3001).
 * Authentication via X-Api-Key header using WORKER_API_KEY.
 */

export class WorkerError extends Error {
  public status: number;
  public code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name   = 'WorkerError';
    this.status = status;
    this.code   = code;
  }
}

// ── Shared types ─────────────────────────────────────────────────────────────

export interface WorkerAccount {
  id:          string;
  name:        string;
  status:      'active' | 'expired' | 'error';
  sessionAge?: number;
}

export interface WorkerParticipant {
  id:          string;
  name:        string;
  headline?:   string;
  avatarUrl?:  string;
  profileUrl?: string;
}

export interface WorkerMessage {
  id:        string;
  chatId:    string;
  senderId:  string;
  text:      string;
  createdAt: string;
  isRead:    boolean;
}

export interface WorkerChat {
  id:           string;
  accountId:    string;
  participants: WorkerParticipant[];
  unreadCount:  number;
  lastMessage?: WorkerMessage;
  createdAt:    string;
}

export interface WorkerProfile {
  id:          string;
  name:        string;
  headline?:   string;
  location?:   string;
  about?:      string;
  avatarUrl?:  string;
  profileUrl?: string;
  company?:    string;
}

export interface Paginated<T> {
  items:   T[];
  cursor:  string | null;
  hasMore: boolean;
}

export type PaginatedChats    = Paginated<WorkerChat>;
export type PaginatedMessages = Paginated<WorkerMessage>;

// ── WorkerClient ──────────────────────────────────────────────────────────────

export class WorkerClient {
  private baseUrl: string;
  private apiKey:  string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = (baseUrl ?? process.env.WORKER_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    this.apiKey  =  apiKey  ?? process.env.WORKER_API_KEY ?? '';

    if (!this.apiKey) {
      throw new WorkerError(
        'WorkerClient: WORKER_API_KEY must be set.',
        500,
        'MISSING_CONFIG'
      );
    }
  }

  // ── Internal request helper ───────────────────────────────────────────────

  private async request<T>(
    method: string,
    path:   string,
    body?:  Record<string, unknown>,
    timeoutMs = 120_000
  ): Promise<T> {
    const url     = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'Accept':    'application/json',
    };
    if (body) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body:   body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      throw new WorkerError(`Worker unreachable: ${msg}`, 503, 'WORKER_OFFLINE');
    }

    if (!res.ok) {
      let payload: { error?: string; code?: string } = {};
      try { payload = await res.json(); } catch { /* ignore */ }
      throw new WorkerError(
        payload.error || `Worker API error ${res.status}`,
        res.status,
        payload.code
      );
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ── Account / session management ─────────────────────────────────────────

  /**
   * Returns a cookie-import URL the user should open.
   * The worker does not do OAuth — the user logs in manually once
   * and then imports their cookies via the dashboard.
   *
   * For now this returns a static instructions URL that the
   * AccountConnectModal will display.
   */
  async generateAuthLink(params: {
    name:               string;
    successRedirectUrl: string;
    failureRedirectUrl: string;
  }): Promise<{ url: string }> {
    // Cookie import is handled via POST /accounts/:id/session directly.
    // Return a special internal URL that the modal intercepts.
    return {
      url: `/accounts/import-cookies?name=${encodeURIComponent(params.name)}&redirect=${encodeURIComponent(params.successRedirectUrl)}`,
    };
  }

  /** Delete all session cookies for an account from Redis. */
  async deleteAccount(workerAccountId: string): Promise<void> {
    return this.request('DELETE', `/accounts/${encodeURIComponent(workerAccountId)}/session`);
  }

  /** Verify a session is alive (navigates to LinkedIn feed). */
  async verifySession(workerAccountId: string): Promise<{ ok: boolean }> {
    return this.request('POST', `/accounts/${encodeURIComponent(workerAccountId)}/verify`);
  }

  /** Raw cookie import — body is the cookies array directly. */
  async importCookiesRaw(workerAccountId: string, cookies: unknown[]): Promise<{ success: boolean; cookieCount: number }> {
    const url     = `${this.baseUrl}/accounts/${encodeURIComponent(workerAccountId)}/session`;
    const headers = {
      'x-api-key':    this.apiKey,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method:  'POST',
        headers,
        body:    JSON.stringify(cookies),
        signal:  AbortSignal.timeout(30_000),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      throw new WorkerError(`Worker unreachable: ${msg}`, 503, 'WORKER_OFFLINE');
    }

    if (!res.ok) {
      let payload: { error?: string } = {};
      try { payload = await res.json(); } catch { /* ignore */ }
      throw new WorkerError(payload.error || `Worker API error ${res.status}`, res.status);
    }

    return res.json();
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  /** Fetch the inbox conversation list. */
  async listChats(workerAccountId: string, _cursor?: string): Promise<PaginatedChats> {
    return this.request('GET', `/messages/inbox?accountId=${encodeURIComponent(workerAccountId)}&limit=20`);
  }

  /** Fetch messages from a specific conversation thread. */
  async getMessages(chatId: string, _cursor?: string): Promise<PaginatedMessages> {
    // chatId format: "accountId::threadId" — split on "::"
    const [accountId, threadId] = chatId.includes('::')
      ? chatId.split('::')
      : [chatId, chatId];

    return this.request(
      'GET',
      `/messages/thread?accountId=${encodeURIComponent(accountId)}&chatId=${encodeURIComponent(threadId)}&limit=50`
    );
  }

  /** Mark a conversation as read (best-effort, never throws). */
  async markChatRead(_chatId: string): Promise<void> {
    // LinkedIn does not have a separate "mark read" API call when
    // viewing the thread — it marks read automatically. No-op here.
    return Promise.resolve();
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  /** Send a message in an existing conversation. */
  async sendMessage(chatId: string, text: string): Promise<WorkerMessage> {
    // chatId stored in DB as "accountId::threadId"
    const [accountId, threadId] = chatId.includes('::')
      ? chatId.split('::')
      : [chatId, chatId];

    return this.request<WorkerMessage>('POST', '/messages/send', {
      accountId,
      chatId:   threadId,
      text,
    });
  }

  /** Send a message to a profile URL (creates new conversation). */
  async sendMessageToProfile(
    workerAccountId: string,
    profileUrl:      string,
    text:            string
  ): Promise<WorkerMessage> {
    return this.request<WorkerMessage>('POST', '/messages/send-new', {
      accountId: workerAccountId,
      profileUrl,
      text,
    });
  }

  // ── Connections ───────────────────────────────────────────────────────────

  /** Send a LinkedIn connection request. */
  async sendConnectionRequest(
    workerAccountId: string,
    profileUrl:      string,
    note?:           string
  ): Promise<void> {
    return this.request('POST', '/connections/send', {
      accountId: workerAccountId,
      profileUrl,
      ...(note ? { note } : {}),
    }, 90_000);
  }

  // ── People search ─────────────────────────────────────────────────────────

  /** Search LinkedIn for people. */
  async searchPeople(workerAccountId: string, query: string): Promise<WorkerProfile[]> {
    return this.request(
      'GET',
      `/people/search?accountId=${encodeURIComponent(workerAccountId)}&q=${encodeURIComponent(query)}&limit=10`
    );
  }
}

// ── Singleton helpers ─────────────────────────────────────────────────────────

let _worker: WorkerClient | null = null;

export function getWorkerClient(): WorkerClient {
  if (!_worker) _worker = new WorkerClient();
  return _worker;
}

export const workerClient = new Proxy({} as WorkerClient, {
  get(_target, prop) {
    return (getWorkerClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
