export interface UnipileAccount {
  id: string;
  provider: string;
  name: string;
  avatar_url: string;
  status: string;
  created_at: string;
}

export interface UnipileParticipant {
  id: string;
  name: string;
  headline?: string;
  avatar_url?: string;
  profile_url?: string;
}

export interface UnipileAttachment {
  id: string;
  type: string;
  url: string;
  name: string;
}

export interface UnipileMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  is_read: boolean;
  attachments?: UnipileAttachment[];
}

export interface UnipileChat {
  id: string;
  account_id: string;
  participants: UnipileParticipant[];
  unread_count: number;
  last_message?: UnipileMessage;
  created_at: string;
}

export interface UnipileProfile {
  id: string;
  name: string;
  headline?: string;
  location?: string;
  about?: string;
  avatar_url?: string;
  profile_url?: string;
  company?: string;
  connections_count?: number;
}

export interface UnipileConnection {
  id: string;
  relation_id: string;
  profile: UnipileProfile;
  connected_at: string;
}

export interface AuthLinkParams {
  success_redirect_url: string;
  failure_redirect_url: string;
  name: string;
  providers: string[];
}

export interface UnipileError {
  message: string;
  status: number;
  code?: string;
}

export interface Paginated<T> {
  items: T[];
  cursor: string | null;
  has_more: boolean;
}

export type PaginatedChats = Paginated<UnipileChat>;
export type PaginatedMessages = Paginated<UnipileMessage>;
export type PaginatedConnections = Paginated<UnipileConnection>;
