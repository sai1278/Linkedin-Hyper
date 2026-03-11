import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Conversation } from '@/types'

interface ConversationsResponse {
  conversations: Conversation[]
  nextCursor?: string
  hasMore: boolean
}

export function useConversations({ 
  accountId, 
  search, 
  filter 
}: { 
  accountId: string | null, 
  search?: string, 
  filter?: string 
}) {
  return useInfiniteQuery<ConversationsResponse>({
    queryKey: ['conversations', accountId, search, filter],
    queryFn: async ({ pageParam = '' }) => {
      if (!accountId) return { conversations: [], hasMore: false }
      const params = new URLSearchParams()
      params.append('accountId', accountId)
      if (pageParam) params.append('cursor', pageParam as string)
      if (search) params.append('search', search)
      if (filter) params.append('filter', filter)

      const res = await fetch(`/api/conversations?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch conversations')
      return res.json()
    },
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    initialPageParam: '',
    enabled: !!accountId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useConversation(id: string | null) {
  return useQuery<Conversation>({
    queryKey: ['conversation', id],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${id}`)
      if (!res.ok) throw new Error('Failed to fetch conversation')
      return res.json()
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}
