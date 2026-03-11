import { useState, useEffect } from 'react'
import { Conversation } from '@/types'
import { useConversations } from '@/hooks/useConversations'
import { Search, Hash, MessageSquareOff } from 'lucide-react'
import { formatRelativeTime, truncate } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface ConversationListProps {
  accountId: string | null
  selectedId: string | null
  onSelect: (conversation: Conversation) => void
}

type FilterType = 'All' | 'Unread' | 'Sent' | 'Requests'

export function ConversationList({ accountId, selectedId, onSelect }: ConversationListProps) {
  const [localSearch, setLocalSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('All')

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(localSearch), 300)
    return () => clearTimeout(handler)
  }, [localSearch])

  // Map FilterType to api filter param
  const getFilterParam = () => {
    if (filter === 'Unread') return 'unread'
    // For Phase 5 we might map Sent/Requests once backend supports it fully, but for now unread is supported
    return undefined 
  }

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status
  } = useConversations({
    accountId,
    search: debouncedSearch,
    filter: getFilterParam()
  })

  const conversations = data?.pages.flatMap(page => page.conversations) || []

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget
    // Trigger near bottom
    if (scrollHeight - scrollTop <= clientHeight * 1.5) {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#1E293B] border-r border-[#334155]">
      
      {/* Search Bar */}
      <div className="p-4 border-b border-[#334155] shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search messages..."
            className="w-full bg-[#0F172A] border border-slate-700 text-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#334155] shrink-0">
        {(['All', 'Unread', 'Sent', 'Requests'] as FilterType[]).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={cn(
              "flex-1 py-3 text-xs font-semibold px-2 transition-colors border-b-2",
              filter === tab 
                ? "text-sky-400 border-sky-400" 
                : "text-slate-400 border-transparent hover:text-slate-200"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        {status === 'pending' ? (
          <div className="divide-y divide-[#334155]">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="p-4 flex gap-3 animate-pulse">
                <div className="w-12 h-12 bg-slate-700 rounded-full shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 bg-slate-700 rounded w-1/3" />
                  <div className="h-3 bg-slate-700 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 p-6 text-center">
            <MessageSquareOff className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm">No conversations found</p>
          </div>
        ) : (
          <div className="divide-y divide-[#334155]">
            {conversations.map(conv => {
              const contactName = conv.contact?.fullName || 'Unknown'
              const isUnread = conv.unreadCount > 0
              const isSelected = selectedId === conv.id
              
              let lastMsgPrefix = ''
              if (conv.lastMessage) {
                lastMsgPrefix = conv.lastMessage.direction === 'OUTBOUND' ? '↑ ' : '↓ '
              }

              return (
                <div 
                  key={conv.id}
                  role="button"
                  onClick={() => onSelect(conv)}
                  className={cn(
                    "p-4 flex gap-3 transition-colors cursor-pointer group",
                    isSelected 
                      ? "bg-[#1E3A5F] border-l-2 border-sky-500 pl-[14px]" 
                      : "hover:bg-[#1E293B]/60"
                  )}
                >
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-sky-900 flex items-center justify-center shrink-0 border border-slate-700 relative">
                    {conv.contact?.avatarUrl ? (
                      <img src={conv.contact.avatarUrl} alt={contactName} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sky-300 font-semibold">{contactName[0]?.toUpperCase() || '?'}</span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="flex justify-between items-baseline mb-1">
                      <h3 className={cn(
                        "text-sm truncate pr-2",
                        isUnread ? "font-bold text-slate-100" : "font-medium text-slate-300 group-hover:text-slate-200"
                      )}>
                        {contactName}
                      </h3>
                      <span className="text-xs text-slate-500 shrink-0">
                        {conv.lastMessageAt ? formatRelativeTime(conv.lastMessageAt) : ''}
                      </span>
                    </div>

                    <div className="flex justify-between items-center gap-2">
                       <p className={cn(
                         "text-xs truncate flex-1",
                         isUnread ? "text-slate-300 font-medium" : "text-slate-500"
                       )}>
                         {lastMsgPrefix}{truncate(conv.lastMessage?.body || '', 60)}
                       </p>
                       
                       {isUnread && (
                         <span className="bg-sky-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[1.25rem] text-center shrink-0">
                           {conv.unreadCount}
                         </span>
                       )}
                    </div>
                  </div>
                </div>
              )
            })}
            
            {isFetchingNextPage && (
               <div className="p-4 flex justify-center">
                 <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
