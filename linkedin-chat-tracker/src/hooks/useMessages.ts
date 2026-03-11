import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message } from '@/types'

interface MessagesResponse {
  messages: Message[]
  nextCursor?: string
  hasMore: boolean
}

export function useMessages(conversationId: string | null) {
  return useInfiniteQuery<MessagesResponse>({
    queryKey: ['messages', conversationId],
    queryFn: async ({ pageParam = '' }) => {
      if (!conversationId) return { messages: [], hasMore: false }
      const params = new URLSearchParams()
      if (pageParam) params.append('cursor', pageParam as string)
      
      const res = await fetch(`/api/conversations/${conversationId}/messages?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch messages')
      return res.json()
    },
    // We are scrolling up to fetch older history
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    initialPageParam: '',
    enabled: !!conversationId,
    staleTime: 10_000,
  })
}

export function useSendMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { chatId?: string; accountId?: string; profileUrl?: string; text: string }) => {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to send message')
      }
      return res.json() as Promise<Message>
    },
    onMutate: async (newMessage) => {
      if (!newMessage.chatId) return { previousMessages: null } // Cant optimistic update for new chats easily
      
      const queryKey = ['messages', newMessage.chatId]
      
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey })

      // Snapshot previous value
      const previousData = queryClient.getQueryData<any>(queryKey)

      // Optimistically update
      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId: newMessage.chatId,
        direction: 'OUTBOUND',
        body: newMessage.text,
        sentAt: new Date().toISOString(),
        deliveryStatus: 'SENT',
        isConnectionRequest: false
      }

      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old || !old.pages) return old
        // Prepend optimistic message to the first page (newest messages assuming we sort by page)
        // Note: the backend returns newest first for infinite scrolling up typically, but we should prepend to the newest page
        const newPages = [...old.pages]
        if (newPages.length > 0) {
          newPages[0] = {
            ...newPages[0],
            messages: [optimisticMessage, ...newPages[0].messages]
          }
        }
        return { ...old, pages: newPages }
      })

      return { previousData, queryKey }
    },
    onError: (err, newMessage, context) => {
      if (context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData)
      }
      // toast.error(err.message)
      console.error(err.message)
    },
    onSettled: (data, err, variables, context) => {
      if (context?.queryKey) {
        queryClient.invalidateQueries({ queryKey: context.queryKey })
        // Also invalidate conversations to update last message
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
      }
    },
  })
}
