// All shared TypeScript interfaces for the LinkedIn Dashboard
// Shapes match the real backend API responses

export interface Account {
  id: string;
  displayName: string;
  isActive: boolean;
  lastSeen: string | null;
}

export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface Message {
  id: string;
  text: string;
  sentAt: number;       // unix ms
  sentByMe: boolean;
  senderName: string;
  status?: MessageStatus;
  error?: string | null;
}

export interface Conversation {
  conversationId: string;
  accountId: string;    // which LinkedIn account owns this thread
  participant: {
    name: string;
    profileUrl: string;
    avatarUrl?: string | null;
  };
  lastMessage: {
    text: string;
    sentAt: number;     // unix ms
    sentByMe: boolean;
    status?: MessageStatus;
  };
  unreadCount: number;
  messages: Message[];
}

export interface ActivityEntry {
  type: 'messageSent' | 'connectionSent' | 'profileViewed' | 'sync';
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
  source?: 'linkedin' | 'connectionSent';
}

export interface HealthAlert {
  id: string;
  severity: 'critical' | 'warning';
  kind: 'session' | 'sync';
  accountId?: string;
  title: string;
  message: string;
}

export interface HealthAccountStatus {
  accountId: string;
  displayName: string;
  hasSession: boolean;
  lastSessionSavedAt: number | null;
  sessionAgeSeconds: number | null;
  lastSyncedAt: number | null;
  lastSyncStatus: 'idle' | 'running' | 'success' | 'warning' | 'failed';
  lastSyncSource: string | null;
  lastSyncStartedAt: number | null;
  lastSyncCompletedAt: number | null;
  lastSyncError: string | null;
  lastSyncStats: {
    conversationsProcessed: number;
    newMessages: number;
    errors: number;
  } | null;
  sessionIssue: {
    code: string;
    message: string;
    detectedAt: number;
  } | null;
  severity: 'healthy' | 'warning' | 'critical';
}

export interface HealthSummary {
  status: 'healthy' | 'warning' | 'critical';
  generatedAt: number;
  syncIntervalMinutes: number;
  totals: {
    totalAccounts: number;
    accountsWithSession: number;
    accountsNeedingAttention: number;
    criticalAlerts: number;
    warningAlerts: number;
  };
  alerts: HealthAlert[];
  accounts: HealthAccountStatus[];
  bulkSync: {
    status: 'idle' | 'running' | 'success' | 'warning' | 'failed';
    source: string;
    startedAt: number | null;
    completedAt: number | null;
    totalAccounts: number;
    successfulAccounts: number;
    totalErrors: number;
    error: string | null;
  };
}

export interface StartupValidationReport {
  status: 'pass' | 'warn' | 'fail';
  generatedAt: number;
  checks: Array<{
    id: string;
    label: string;
    title?: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
    accountAccessConfigPresent?: boolean;
    initialAdminEmailsConfigured?: boolean;
    initialAdminEmailCount?: number;
    userAccountAccessConfigured?: boolean;
    userAccountAccessEntryCount?: number;
  }>;
  healthSummary: {
    status: 'healthy' | 'warning' | 'critical';
    criticalAlerts: number;
    warningAlerts: number;
    accountsNeedingAttention: number;
  };
}

export interface JobResult {
  status: 'completed' | 'failed' | 'active' | 'waiting';
  result?: unknown;
  error?: string;
}

export type ActivityTab = 'all' | 'messageSent' | 'connectionSent' | 'profileViewed' | 'sync';
