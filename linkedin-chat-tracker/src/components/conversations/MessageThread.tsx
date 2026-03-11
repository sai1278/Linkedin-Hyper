import { useEffect, useRef } from 'react'
import { Conversation, Message } from '@/types'
import { formatRelativeTime } from '@/lib/utils'
import { ExternalLink, ArrowLeft, Check, CheckCheck, XCircle, Loader2, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface MessageThreadProps {
  conversation: Conversation
  messages: Message[]
  hasMore: boolean
  onLoadMore: () => void
  isLoadingMore: boolean
  onBack?: () => void
}

export function MessageThread({
  conversation,
  messages,
  hasMore,
  onLoadMore,
  isLoadingMore,
  onBack
}: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleScroll = () => {
    if (!scrollRef.current) return
    // Since flex-col-reverse, scrollTop is negative or we check distance to top (which is scrollHeight - clientHeight - Math.abs(scrollTop))
    // Actually with flex-col-reverse, scrollTop is usually 0 at bottom, and goes negative. Wait, standard is that reaching top triggers load.
    // Let's use standard detection:
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    
    // In flex-col-reverse, scrolling UP means scrollTop goes towards negative (in some browsers) or towards 0 (if top is 0). 
    // Just a simple approximation for now:
    if (Math.abs(scrollTop) >= scrollHeight - clientHeight - 100) {
      if (hasMore && !isLoadingMore) {
        onLoadMore()
      }
    }
  }

  // Group messages by day
  const groupedMessages: { dateLabel: string, msgs: Message[] }[] = []
  let currentGroup: { dateLabel: string, msgs: Message[] } | null = null

  // Messages are assumed to be sorted newest first (since it's flex-col-reverse)
  // We need to group them.
  messages.forEach(msg => {
    const d = new Date(msg.sentAt)
    const dateLabel = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    
    if (!currentGroup || currentGroup.dateLabel !== dateLabel) {
      currentGroup = { dateLabel, msgs: [msg] }
      groupedMessages.push(currentGroup)
    } else {
      currentGroup.msgs.push(msg)
    }
  })

  return (
    <div className="flex flex-col h-full bg-[#0F172A]">
      
      {/* Header */}
      <div className="h-16 border-b border-[#334155] bg-[#1E293B] px-4 flex items-center justify-between shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          {onBack && (
            <button 
              onClick={onBack}
              className="md:hidden mr-2 text-slate-400 hover:text-slate-200"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div className="w-10 h-10 rounded-full overflow-hidden bg-sky-900 border border-slate-700 shrink-0 flex items-center justify-center">
            {conversation.contact.avatarUrl ? (
              <img src={conversation.contact.avatarUrl} alt={conversation.contact.fullName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-sky-300 font-semibold">{conversation.contact.fullName[0]?.toUpperCase() || '?'}</span>
            )}
          </div>
          
          <div className="flex flex-col">
            <h2 className="text-slate-100 font-semibold text-sm leading-tight">{conversation.contact.fullName}</h2>
            <p className="text-slate-400 text-xs truncate max-w-[200px] md:max-w-md">
              {conversation.contact.headline || 'LinkedIn Member'}
            </p>
          </div>
        </div>

        <Link 
          href={conversation.contact.profileUrl || '#'} 
          target="_blank"
          className="flex items-center gap-2 px-3 py-1.5 bg-[#0F172A] hover:bg-[#334155] border border-[#334155] rounded-md text-xs font-medium text-slate-300 transition-colors"
        >
          <span className="hidden sm:inline">View Profile</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Message List */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto flex flex-col-reverse p-4 gap-6"
      >
        {messages.length === 0 && !isLoadingMore && (
           <div className="flex flex-col items-center justify-center h-full text-slate-500 my-auto">
             <MessageSquare className="w-12 h-12 mb-4 opacity-30" />
             <p>No messages yet — start the conversation below</p>
           </div>
        )}

        {/* Note: since it's col-reverse, map over groupedMessages as they are (newest first). 
            But within the group, messages are also newest first. */}
        {groupedMessages.map((group, gIdx) => (
          <div key={group.dateLabel} className="flex flex-col-reverse gap-4">
            
            {group.msgs.map((msg, mIdx) => {
              const isOutbound = msg.direction === 'OUTBOUND'
              
              if (msg.isConnectionRequest) {
                return (
                  <div key={msg.id} className="w-full flex justify-center animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl px-4 py-3 max-w-md w-full text-center shadow-sm">
                      <div className="text-xs font-semibold text-violet-400 mb-1 uppercase tracking-wider">
                        Connection Request
                      </div>
                      <p className="text-slate-300 text-sm italic">
                        "{msg.body || 'No note attached'}"
                      </p>
                    </div>
                  </div>
                )
              }

              return (
                <div 
                  key={msg.id} 
                  className={cn(
                    "flex flex-col max-w-[75%] animate-in fade-in slide-in-from-bottom-2 duration-300",
                    isOutbound ? "self-end items-end" : "self-start items-start"
                  )}
                >
                  <div className={cn(
                    "px-4 py-2.5 shadow-sm text-sm whitespace-pre-wrap break-words",
                    isOutbound 
                      ? "bg-sky-600 text-white rounded-2xl rounded-tr-sm" 
                      : "bg-[#1E293B] border border-[#334155] text-slate-200 rounded-2xl rounded-tl-sm"
                  )}>
                    {msg.body}
                  </div>
                  
                  <div className="flex items-center gap-1.5 mt-1.5 px-1">
                    <span className="text-[10px] text-slate-500 font-medium">
                      {new Date(msg.sentAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    {isOutbound && (
                      <span className="text-slate-500">
                        {msg.deliveryStatus === 'SENT' && <Check className="w-3 h-3" />}
                        {msg.deliveryStatus === 'DELIVERED' && <CheckCheck className="w-3 h-3 text-slate-400" />}
                        {msg.deliveryStatus === 'READ' && <CheckCheck className="w-3 h-3 text-sky-400" />}
                        {msg.deliveryStatus === 'FAILED' && <XCircle className="w-3 h-3 text-red-400" />}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Date Separator (top of the group, but since flex-col-reverse it comes last in DOM) */}
            <div className="flex items-center justify-center my-4 opacity-70">
              <div className="h-px bg-[#334155] flex-1 max-w-[50px]" />
              <div className="px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                {group.dateLabel}
              </div>
              <div className="h-px bg-[#334155] flex-1 max-w-[50px]" />
            </div>

          </div>
        ))}

        {isLoadingMore && (
          <div className="flex justify-center p-4">
            <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}
