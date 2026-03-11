import { useQuery } from '@tanstack/react-query'

export interface AnalyticsData {
  stats: {
    totalMessagesSent: number
    totalConnectionsSent: number
    totalRepliesReceived: number
    connectionsAccepted: number
    responseRate: number
    acceptanceRate: number
  }
  dailySeries: Array<{
    date: string
    messagesSent: number
    connectionsSent: number
    replies: number
  }>
  topContacts: Array<{
    contactId: string
    name: string
    avatarUrl: string | null
    messageCount: number
    replied: boolean
  }>
  activityLog: Array<{
    id: string
    action: string
    metadata: any
    occurredAt: string
  }>
}

export function useAnalytics(accountId: string | null, period: '7d' | '30d' | '90d' | 'all') {
  return useQuery<AnalyticsData>({
    queryKey: ['analytics', accountId, period],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/${accountId}?period=${period}`)
      if (!res.ok) throw new Error('Failed to fetch analytics')
      return res.json()
    },
    enabled: !!accountId,
    staleTime: 300_000, // 5 mins
  })
}

export function useAllAccountsStats() {
  return useQuery({
    queryKey: ['analytics', 'all-accounts'],
    queryFn: async () => {
      // In a real app we'd aggregate via a backend endpoint.
      // For Phase 6 Mock, we fetch accounts, then sum up generic numbers
      const accountsRes = await fetch('/api/accounts')
      const accounts = await accountsRes.json()
      
      // Mocked aggregation for overview dashboard
      return {
        totalConversations: accounts.reduce((acc: number, cur: any) => acc + (cur._count?.conversations || 0), 0),
        messagesSentToday: Math.floor(Math.random() * 50) + 10,
        connectionsToday: Math.floor(Math.random() * 20),
        unreadMessages: accounts.reduce((acc: number, cur: any) => acc + (cur.unreadCount || 0), 0) // assuming schema update or UI sum
      }
    },
    staleTime: 300_000,
  })
}
