export interface LinkedInAccount {
  id: string
  unipileAccountId: string
  displayName: string
  profilePicUrl: string | null
  status: 'ACTIVE' | 'DISCONNECTED' | 'ERROR'
  connectedAt: string
  lastSyncAt: string | null
  _count?: {
    conversations: number
  }
}

export interface AccountStats {
  totalConversations: number
  totalMessagesSent: number
  totalConnectionsSent: number
  totalRepliesReceived: number
  responseRate: number
  unreadCount: number
}

export interface Conversation {
  id: string
  unipileChatId: string
  accountId: string
  contact: {
    id: string
    fullName: string
    headline: string | null
    profileUrl: string
    avatarUrl: string | null
  }
  lastMessageAt: string | null
  unreadCount: number
  status: 'ACTIVE' | 'ARCHIVED'
  lastMessage?: {
    body: string
    direction: 'INBOUND' | 'OUTBOUND'
    sentAt: string
  }
}

export interface Message {
  id: string
  conversationId: string
  direction: 'INBOUND' | 'OUTBOUND'
  body: string
  sentAt: string
  deliveryStatus: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  isConnectionRequest: boolean
}
