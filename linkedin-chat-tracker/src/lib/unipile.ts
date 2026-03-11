import {
  UnipileAccount,
  UnipileChat,
  UnipileMessage,
  UnipileProfile,
  UnipileConnection,
  AuthLinkParams,
  PaginatedChats,
  PaginatedMessages,
  PaginatedConnections,
  UnipileError as IUnipileError,
} from '@/types/unipile';

export class UnipileError extends Error implements IUnipileError {
  public status: number;
  public code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'UnipileError';
    this.status = status;
    this.code = code;
  }
}

export class UnipileClient {
  private dsn: string;
  private token: string;

  constructor(dsn: string, token: string) {
    this.dsn = dsn.replace(/\/$/, '');
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.dsn}${path.startsWith('/') ? path : `/${path}`}`;
    let retries = 1;

    while (true) {
      const headers: Record<string, string> = {
        'X-API-KEY': this.token,
        'Accept': 'application/json',
      };

      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(15000),
        });

        if (response.status === 429 && retries > 0) {
          retries--;
          const retryAfter = response.headers.get('Retry-After');
          const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
          await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
          continue;
        }

        if (!response.ok) {
          let errorData: any = {};
          try {
            errorData = await response.json();
          } catch {
            errorData.message = response.statusText;
          }
          throw new UnipileError(
            errorData.message || `HTTP Error ${response.status}`,
            response.status,
            errorData.code
          );
        }

        return (await response.json()) as T;
      } catch (error: any) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          throw new UnipileError('Request timed out', 408);
        }
        if (error instanceof UnipileError) {
          throw error;
        }
        throw new UnipileError(error.message || 'Network error', 500);
      }
    }
  }

  // Account Management
  async listAccounts(): Promise<UnipileAccount[]> {
    const res = await this.request<{ accounts: UnipileAccount[] }>('GET', '/api/v1/accounts');
    return res.accounts;
  }

  async getAccount(accountId: string): Promise<UnipileAccount> {
    return this.request<UnipileAccount>('GET', `/api/v1/accounts/${accountId}`);
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/accounts/${accountId}`);
  }

  async generateAuthLink(params: AuthLinkParams): Promise<{ url: string }> {
    return this.request<{ url: string }>('POST', '/api/v1/hosted/accounts/link', params);
  }

  // Conversations / Inbox
  async listChats(accountId: string, cursor?: string): Promise<PaginatedChats> {
    const params = new URLSearchParams({ account_id: accountId });
    if (cursor) params.append('cursor', cursor);
    return this.request<PaginatedChats>('GET', `/api/v1/chats?${params.toString()}`);
  }

  async getChat(chatId: string): Promise<UnipileChat> {
    return this.request<UnipileChat>('GET', `/api/v1/chats/${chatId}`);
  }

  async getMessages(chatId: string, cursor?: string): Promise<PaginatedMessages> {
    const params = new URLSearchParams();
    if (cursor) params.append('cursor', cursor);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<PaginatedMessages>('GET', `/api/v1/chats/${chatId}/messages${qs}`);
  }

  async markChatRead(chatId: string): Promise<void> {
    await this.request<void>('POST', `/api/v1/chats/${chatId}/read`);
  }

  // Messaging
  async sendMessage(chatId: string, text: string): Promise<UnipileMessage> {
    return this.request<UnipileMessage>('POST', `/api/v1/chats/${chatId}/messages`, { text });
  }

  async sendMessageToProfile(accountId: string, profileUrl: string, text: string): Promise<UnipileMessage> {
    // Note: Creating a message with a new contact usually requires passing attendees in chat creation
    const res = await this.request<any>('POST', '/api/v1/chats', {
      account_id: accountId,
      attendees_ids: [profileUrl],
      text
    });
    return res.message || res;
  }

  // Connections
  async sendConnectionRequest(accountId: string, userId: string, note?: string): Promise<void> {
    await this.request<void>('POST', '/api/v1/users/invite', {
      account_id: accountId,
      provider_id: userId,
      message: note
    });
  }

  async listConnections(accountId: string, cursor?: string): Promise<PaginatedConnections> {
    const params = new URLSearchParams({ account_id: accountId });
    if (cursor) params.append('cursor', cursor);
    return this.request<PaginatedConnections>('GET', `/api/v1/users/relations?${params.toString()}`);
  }

  async withdrawConnection(relationId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/users/relations/${relationId}`);
  }

  // Profiles
  async getProfile(userId: string): Promise<UnipileProfile> {
    return this.request<UnipileProfile>('GET', `/api/v1/users/${userId}`);
  }

  async searchPeople(accountId: string, query: string): Promise<UnipileProfile[]> {
    const params = new URLSearchParams({ account_id: accountId, search: query });
    const res = await this.request<{ items: UnipileProfile[] }>('GET', `/api/v1/users?${params.toString()}`);
    return res.items;
  }

  // Posts
  async createPost(accountId: string, text: string): Promise<void> {
    await this.request<void>('POST', '/api/v1/posts', {
      account_id: accountId,
      text
    });
  }
}

if (!process.env.UNIPILE_DSN || !process.env.UNIPILE_ACCESS_TOKEN) {
  throw new Error('FATAL: UNIPILE_DSN and UNIPILE_ACCESS_TOKEN must be set');
}

export const unipile = new UnipileClient(
  process.env.UNIPILE_DSN,
  process.env.UNIPILE_ACCESS_TOKEN
);
