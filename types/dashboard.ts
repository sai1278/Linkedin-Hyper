// All shared TypeScript interfaces for the LinkedIn Dashboard
// Shapes match the real backend API responses

export interface Account {
  id: string;
  displayName: string;
  isActive: boolean;
  lastSeen: string | null;
}

export interface Message {
  id: string;
  text: string;
  sentAt: number;       // unix ms
  sentByMe: boolean;
  senderName: string;
}

export interface Conversation {
  conversationId: string;
  accountId: string;    // which LinkedIn account owns this thread
  participant: {
    name: string;
    profileUrl: string;
  };
  lastMessage: {
    text: string;
    sentAt: number;     // unix ms
    sentByMe: boolean;
  };
  unreadCount: number;
  messages: Message[];
}

export interface ActivityEntry {
  type: 'messageSent' | 'connectionSent' | 'profileViewed';
  accountId: string;
  targetName: string;
  targetProfileUrl: string;
  message?: string;
  timestamp: number;   // unix ms
}

export interface Connection {
  accountId: string;
  name: string;
  profileUrl: string;
  headline?: string;
  connectedAt?: number; // unix ms
}

export interface JobResult {
  status: 'completed' | 'failed' | 'active' | 'waiting';
  result?: unknown;
  error?: string;
}

export type ActivityTab = 'all' | 'messageSent' | 'connectionSent' | 'profileViewed';
