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

export interface AllAccountsStats {
  totalConversations: number
  messagesSentToday: number
  connectionsToday: number
  unreadMessages: number
}

export function useAllAccountsStats() {
  return useQuery<AllAccountsStats>({
    queryKey: ['all-accounts-stats'],
    queryFn: async (): Promise<AllAccountsStats> => {
      const res = await fetch('/api/analytics/summary')
      if (!res.ok) throw new Error('Failed to fetch summary stats')
      return res.json()
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // auto-refresh every 5 minutes
  })
}
