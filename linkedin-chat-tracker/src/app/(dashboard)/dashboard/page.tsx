'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useAllAccountsStats } from '@/hooks/useAnalytics'
import { useAccounts } from '@/hooks/useAccounts'
import { StatsCard } from '@/components/analytics/StatsCard'
import { AccountCard } from '@/components/accounts/AccountCard'
import { MessageSquare, Send, UserPlus, Bell, Clock, Search, Sparkles } from 'lucide-react'
import { formatRelativeTime, cn } from '@/lib/utils'
import { useSendMessage } from '@/hooks/useMessages'

export default function DashboardOverviewPage() {
  const { data: session } = useSession()
  const router = useRouter()
  
  const { data: stats, isLoading: statsLoading } = useAllAccountsStats()
  const { data: accounts, isLoading: accountsLoading } = useAccounts()
  
  const [recipient, setRecipient] = useState('')
  const [messageText, setMessageText] = useState('')
  const [selectedComposeAccount, setSelectedComposeAccount] = useState<string>('')
  
  const { mutate: sendMessage, isPending: isSending } = useSendMessage()

  const handleQuickSend = () => {
    if (!selectedComposeAccount || !recipient || !messageText) return
    sendMessage({
      accountId: selectedComposeAccount,
      profileUrl: recipient,
      text: messageText
    }, {
      onSuccess: () => {
        setMessageText('')
        setRecipient('')
        alert('Message sent successfully!')
      }
    })
  }

  return (
    <div className="max-w-7xl mx-auto pb-12 space-y-8">
      
      {/* 1. Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {session?.user?.name || 'User'} 👋
        </h1>
        <p className="text-slate-400 text-sm mt-1">Here's your global overview for {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* 2. Quick Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard 
          label="Total Conversations" 
          value={stats?.totalConversations || 0} 
          icon={MessageSquare} 
          color="sky" 
          loading={statsLoading}
        />
        <StatsCard 
          label="Messages Sent (Today)" 
          value={stats?.messagesSentToday || 0} 
          icon={Send} 
          color="emerald" 
          loading={statsLoading}
        />
        <StatsCard 
          label="Connections (Today)" 
          value={stats?.connectionsToday || 0} 
          icon={UserPlus} 
          color="violet" 
          loading={statsLoading}
        />
        <StatsCard 
          label="Unread Messages" 
          value={stats?.unreadMessages || 0} 
          icon={Bell} 
          color="amber" 
          loading={statsLoading}
        />
      </div>

      {/* 3. Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Needs Reply */}
        <div className="bg-[#1E293B] border border-[#334155] rounded-2xl flex flex-col overflow-hidden">
          <div className="p-5 border-b border-[#334155] flex justify-between items-center bg-[#0F172A]/50">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <h2 className="text-base font-semibold text-slate-100">Needs Reply</h2>
            </div>
            <button 
              onClick={() => router.push('/conversations')}
              className="text-xs font-medium text-sky-400 hover:text-sky-300"
            >
              View All
            </button>
          </div>
          <div className="p-2 space-y-1">
            {/* Mock Needs Reply List */}
            {statsLoading ? (
               <div className="p-4 flex justify-center text-slate-500">Loading...</div>
            ) : (
              [
                { id: '1', name: 'Sarah Jenkins', time: new Date(Date.now() - 3600000), preview: 'Can we schedule a quick call about this?' },
                { id: '2', name: 'Michael Chen', time: new Date(Date.now() - 7200000), preview: 'Thanks, I will take a look at the repo.' },
                { id: '3', name: 'Emily Ross', time: new Date(Date.now() - 86400000), preview: 'Are you available next Tuesday?' },
              ].map((item) => (
                <div key={item.id} className="p-3 hover:bg-[#0F172A] rounded-xl transition-colors group flex items-start gap-4 cursor-pointer" onClick={() => router.push(`/conversations?id=${item.id}`)}>
                   <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center shrink-0 border border-[#334155] text-slate-300 font-semibold text-sm">
                     {item.name[0]}
                   </div>
                   <div className="flex-1 min-w-0">
                     <div className="flex justify-between items-center mb-0.5">
                       <span className="font-medium text-slate-200 text-sm group-hover:text-sky-400 transition-colors">{item.name}</span>
                       <span className="text-xs text-slate-500 flex items-center gap-1">
                         <Clock className="w-3 h-3" /> {formatRelativeTime(item.time)}
                       </span>
                     </div>
                     <p className="text-xs text-slate-400 truncate">{item.preview}</p>
                   </div>
                   <button className="opacity-0 group-hover:opacity-100 transition-opacity bg-sky-500/10 text-sky-400 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0">
                     Reply →
                   </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Global Activity */}
        <div className="bg-[#1E293B] border border-[#334155] rounded-2xl flex flex-col overflow-hidden">
          <div className="p-5 border-b border-[#334155] bg-[#0F172A]/50">
            <h2 className="text-base font-semibold text-slate-100">Today's Activity</h2>
          </div>
          <div className="p-5 overflow-y-auto max-h-[300px] relative">
            <div className="absolute left-[27px] top-6 bottom-6 w-px bg-[#334155]" />
            <div className="space-y-6">
              {[
                { type: 'MSG', text: 'Sent message to David Miller', time: '10 mins ago', icon: <Send className="w-3.5 h-3.5 text-sky-400" /> },
                { type: 'CONN', text: 'Connected with Elena Ford', time: '1 hour ago', icon: <UserPlus className="w-3.5 h-3.5 text-emerald-400" /> },
                { type: 'MSG', text: 'Received message from Sarah J.', time: '2 hours ago', icon: <Bell className="w-3.5 h-3.5 text-violet-400" /> },
                { type: 'CONN', text: 'Sent request to James Smith', time: '3 hours ago', icon: <UserPlus className="w-3.5 h-3.5 text-amber-400" /> },
              ].map((act, i) => (
                <div key={i} className="flex gap-4 relative z-10 w-full">
                   <div className="w-6 h-6 rounded-full bg-[#0F172A] border border-[#334155] flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                     {act.icon}
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="text-sm font-medium text-slate-200 truncate">{act.text}</p>
                     <p className="text-xs text-slate-500 mt-0.5">{act.time}</p>
                   </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* 4. Connected Accounts */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Active Accounts</h2>
          <button 
            onClick={() => router.push('/accounts')}
            className="text-sm font-medium text-sky-400 hover:text-sky-300"
          >
            Manage Accounts
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accountsLoading ? (
            <div className="h-48 bg-[#1E293B] rounded-2xl animate-pulse" />
          ) : accounts?.slice(0, 3).map((acc) => (
            <AccountCard 
              key={acc.id} 
              account={acc} 
              onDisconnect={() => {}} 
            />
          ))}
        </div>
      </div>

      {/* 5. Quick Compose Widget */}
      <div className="bg-[#1E293B] border border-[#334155] rounded-2xl p-6 relative overflow-hidden">
        {/* Background spark */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        
        <div className="flex items-center gap-2 mb-6">
          <Sparkles className="w-5 h-5 text-violet-400" />
          <h2 className="text-lg font-semibold text-slate-100">Quick Compose</h2>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-[0.8] flex flex-col gap-4">
            <select 
              value={selectedComposeAccount}
              onChange={(e) => setSelectedComposeAccount(e.target.value)}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-xl px-4 py-2.5 text-sm font-medium text-slate-200 focus:outline-none focus:border-sky-500/50"
            >
              <option value="" disabled>Select Outbound Account...</option>
              {accounts?.map(a => (
                <option key={a.id} value={a.id}>{a.displayName}</option>
              ))}
            </select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text" 
                placeholder="Recipient LinkedIn URL or name..."
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50"
              />
            </div>
          </div>

          <div className="flex-[1.2] flex flex-col bg-[#0F172A] border border-[#334155] rounded-xl overflow-hidden focus-within:border-sky-500/50 transition-colors">
             <textarea 
               placeholder="Write your message here..."
               value={messageText}
               onChange={e => setMessageText(e.target.value)}
               className="w-full h-24 bg-transparent resize-none p-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
             />
             <div className="bg-[#1E293B] border-t border-[#334155] px-3 py-2 flex justify-between items-center">
               <span className="text-xs text-slate-500 font-medium">{messageText.length} chars</span>
               <button 
                 onClick={handleQuickSend}
                 disabled={!selectedComposeAccount || !recipient || !messageText.trim() || isSending}
                 className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 disabled:bg-[#334155] disabled:text-slate-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
               >
                 {isSending ? 'Sending...' : (
                   <>Send <Send className="w-3.5 h-3.5" /></>
                 )}
               </button>
             </div>
          </div>
        </div>

      </div>

    </div>
  )
}
