'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useUIStore } from '@/store/uiStore'
import { ConversationList } from '@/components/conversations/ConversationList'
import { MessageThread } from '@/components/conversations/MessageThread'
import { ComposeBox } from '@/components/conversations/ComposeBox'
import { useConversations, useConversation } from '@/hooks/useConversations'
import { useMessages } from '@/hooks/useMessages'
import { MessageSquare } from 'lucide-react'
import { useEffect } from 'react'

export default function ConversationsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlConversationId = searchParams.get('id')
  
  const { 
    selectedAccountId,
    activeConversationId, 
    setActiveConversation
  } = useUIStore()

  // Sync state with URL
  const selectedId = urlConversationId || activeConversationId

  useEffect(() => {
    if (urlConversationId && urlConversationId !== activeConversationId) {
      setActiveConversation(urlConversationId)
    }
  }, [urlConversationId, activeConversationId, setActiveConversation])

  // Fetch selected conversation details
  const { data: conversation } = useConversation(selectedId)
  
  // Fetch messages for selected
  const { 
    data: messagesData, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = useMessages(selectedId)

  const messages = messagesData?.pages.flatMap(p => p.messages) || []

  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-6"> {/* Negative margin to counteract layout p-6 padding to make it full height */}
      
      {/* LEFT PANEL */}
      <div className={`w-full md:w-80 flex-none flex flex-col ${selectedId ? 'hidden md:flex' : 'flex'}`}>
        <ConversationList 
          accountId={selectedAccountId}
          selectedId={selectedId}
          onSelect={(conv) => {
            setActiveConversation(conv.id)
            router.push(`/conversations?id=${conv.id}`, { scroll: false })
          }}
        />
      </div>

      {/* RIGHT PANEL */}
      <div className={`flex-1 flex flex-col bg-[#0F172A] min-w-0 ${!selectedId ? 'hidden md:flex' : 'flex'}`}>
        
        {selectedId && conversation ? (
          <>
            <div className="flex-1 overflow-hidden">
              <MessageThread 
                conversation={conversation}
                messages={messages}
                hasMore={!!hasNextPage}
                onLoadMore={() => fetchNextPage()}
                isLoadingMore={isFetchingNextPage}
                onBack={() => {
                  setActiveConversation(null)
                  router.push('/conversations', { scroll: false })
                }}
              />
            </div>
            
            <div className="flex-none">
               <ComposeBox 
                 conversationId={conversation.id}
                 accountId={conversation.accountId}
                 contact={conversation.contact}
               />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-[#0F172A]">
             <div className="w-20 h-20 bg-[#1E293B] rounded-full flex items-center justify-center mb-6 border border-[#334155]">
               <MessageSquare className="w-8 h-8 opacity-50" />
             </div>
             <p className="text-sm font-medium">Select a conversation</p>
          </div>
        )}
        
      </div>
    </div>
  )
}
