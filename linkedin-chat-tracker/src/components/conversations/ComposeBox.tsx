import { useState, useRef, useEffect } from 'react'
import { useSendMessage } from '@/hooks/useMessages'
import { Send, Sparkles, UserPlus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ComposeBoxProps {
  conversationId?: string
  accountId: string
  contact?: { fullName: string; profileUrl: string }
}

type Tab = 'MESSAGE' | 'CONNECT'

export function ComposeBox({ conversationId, accountId, contact }: ComposeBoxProps) {
  const [activeTab, setActiveTab] = useState<Tab>('MESSAGE')
  const [text, setText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const { mutate: sendMessage, isPending: isSendingMessage } = useSendMessage()

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }, [text])

  const handleSend = () => {
    if (!text.trim() || isSendingMessage) return

    if (activeTab === 'MESSAGE') {
      if (!conversationId && (!contact?.profileUrl)) return

      sendMessage({
        chatId: conversationId,
        accountId: conversationId ? undefined : accountId,
        profileUrl: conversationId ? undefined : contact?.profileUrl,
        text
      }, {
        onSuccess: () => setText('')
      })
    } else {
      // Send connection request logic (Phase 5 placeholder for connect route call)
      fetch('/api/connect/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          userId: contact?.profileUrl, // Usually provider_id is extracted from profileUrl, but keeping simple
          note: text
        })
      }).then(res => {
        if (res.ok) {
          setText('')
          alert('Connection request sent')
        } else {
          alert('Failed to send connection request')
        }
      })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  const handleGenerateAI = async () => {
    if (!contact?.fullName) return
    setIsGenerating(true)
    try {
      // Mock AI generation
      await new Promise(r => setTimeout(r, 1500))
      setText(`Hi ${contact.fullName.split(' ')[0]},\n\nI came across your profile and would love to connect. I'm impressed by your background and think it would be great to stay in touch.`)
    } catch (e) {
      console.error(e)
    } finally {
      setIsGenerating(false)
    }
  }

  const maxLength = activeTab === 'MESSAGE' ? 8000 : 300
  const isOverLimit = text.length > (activeTab === 'MESSAGE' ? 7500 : 300)

  return (
    <div className="bg-[#1E293B] border-t border-[#334155] p-3 sm:p-4 shrink-0 transition-all z-20 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.3)]">
      
      {/* Tabs */}
      <div className="flex items-center gap-1 mb-3">
        <button
          onClick={() => setActiveTab('MESSAGE')}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5 border",
            activeTab === 'MESSAGE' 
              ? "bg-[#0F172A] border-[#334155] text-sky-400 shadow-sm"
              : "border-transparent text-slate-400 hover:text-slate-200"
          )}
        >
          <Send className="w-3.5 h-3.5" />
          Message
        </button>
        <button
          onClick={() => setActiveTab('CONNECT')}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5 border",
            activeTab === 'CONNECT'
              ? "bg-[#0F172A] border-[#334155] text-violet-400 shadow-sm"
              : "border-transparent text-slate-400 hover:text-slate-200"
          )}
        >
          <UserPlus className="w-3.5 h-3.5" />
          Connect
        </button>
      </div>

      <div className="relative bg-[#0F172A] border border-[#334155] rounded-xl focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/50 transition-all p-1 flex">
        
        <div className="flex-1 flex flex-col pt-2 pb-1 px-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeTab === 'MESSAGE' ? `Write a message to ${contact?.fullName || 'them'}...` : "Add an optional note (max 300 chars)..."}
            className="w-full bg-transparent text-slate-200 text-sm placeholder:text-slate-500 resize-none outline-none leading-relaxed flex-1"
            rows={1}
            maxLength={maxLength}
          />

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#334155]/50">
            {/* Left AI / formatting tools */}
            <div className="flex items-center gap-2">
              {activeTab === 'CONNECT' && (
                <button
                  onClick={handleGenerateAI}
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 text-xs font-medium text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 px-2 py-1 rounded transition-colors disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Generate Note
                </button>
              )}
            </div>

            {/* Right Character Count */}
            <span className={cn(
              "text-[10px] font-medium transition-colors",
              isOverLimit ? "text-red-400" : "text-slate-500"
            )}>
              {text.length} / {maxLength}
            </span>
          </div>
        </div>

        {/* Send Button */}
        <div className="pl-2 flex items-end justify-center pb-2 pr-2">
          <button
            onClick={handleSend}
            disabled={!text.trim() || isSendingMessage || isOverLimit}
            className="w-10 h-10 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:bg-[#334155] disabled:text-slate-500 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all shadow-sm group"
            title="Send (Cmd/Ctrl + Enter)"
          >
            {isSendingMessage ? (
               <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
               <Send className="w-4 h-4 ml-0.5 group-hover:scale-110 transition-transform" />
            )}
          </button>
        </div>
      </div>
      
    </div>
  )
}
