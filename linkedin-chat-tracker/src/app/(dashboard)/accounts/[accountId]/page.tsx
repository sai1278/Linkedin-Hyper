'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useAccount, useDisconnectAccount } from '@/hooks/useAccounts'
import { formatRelativeTime } from '@/lib/utils'
import { 
  ChevronRight, 
  MessageSquare, 
  Send, 
  UserPlus, 
  Users, 
  Activity,
  RefreshCw,
  LogOut,
  Check,
  Bell
} from 'lucide-react'

// Mock analytics for Phase 4
const mockAnalytics = {
  totalConversations: 142,
  totalMessagesSent: 489,
  totalConnectionsSent: 120,
  responseRate: 35.5,
}

// Mock activity log
const mockActivities = [
  { id: 1, type: 'MESSAGE_SENT', text: 'Sent message to Sarah Jenks', time: new Date(Date.now() - 1000 * 60 * 5) },
  { id: 2, type: 'CONNECTION_ACCEPTED', text: 'John Doe accepted your connection request', time: new Date(Date.now() - 1000 * 60 * 45) },
  { id: 3, type: 'CONNECTION_SENT', text: 'Sent connection request to Mike Smith', time: new Date(Date.now() - 1000 * 60 * 60 * 2) },
  { id: 4, type: 'INBOUND_MESSAGE', text: 'Received message from Jane Doe', time: new Date(Date.now() - 1000 * 60 * 60 * 5) },
]

export default function AccountDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { data: account, isLoading } = useAccount(params.accountId as string)
  const { mutate: disconnect } = useDisconnectAccount()
  const [isSyncing, setIsSyncing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    )
  }

  if (!account) {
    return (
      <div className="max-w-6xl mx-auto p-4 text-center">
        <h2 className="text-xl font-semibold text-slate-200">Account not found</h2>
        <button onClick={() => router.push('/accounts')} className="text-sky-400 hover:underline mt-4">Return to Accounts</button>
      </div>
    )
  }

  const handleSync = async () => {
    setIsSyncing(true)
    // Placeholder sync call
    await new Promise(r => setTimeout(r, 1500))
    setIsSyncing(false)
  }

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'CONNECTION_SENT': return <UserPlus className="w-4 h-4 text-purple-400" />
      case 'CONNECTION_ACCEPTED': return <Check className="w-4 h-4 text-emerald-400" />
      case 'MESSAGE_SENT': return <Send className="w-4 h-4 text-sky-400" />
      default: return <Bell className="w-4 h-4 text-slate-400" />
    }
  }

  return (
    <div className="max-w-6xl mx-auto pb-12">
      
      {/* 1. Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <Link href="/accounts" className="hover:text-slate-200 transition-colors">Accounts</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-slate-200 font-medium">{account.displayName}</span>
      </div>

      {/* 2. Header Card */}
      <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6 mb-8 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-full overflow-hidden bg-[#0F172A] border-2 border-[#334155] shrink-0">
            {account.profilePicUrl ? (
              <img src={account.profilePicUrl} alt={account.displayName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-slate-400">
                {account.displayName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">{account.displayName}</h1>
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400`}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {account.status}
              </span>
              <span className="text-sm text-slate-400">
                Connected {formatRelativeTime(account.connectedAt || new Date())}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto relative">
          <button 
            onClick={handleSync}
            disabled={isSyncing}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
          <button 
            onClick={() => setShowConfirm(true)}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Disconnect
          </button>

          {showConfirm && (
            <div className="absolute top-full right-0 mt-2 w-72 bg-[#1E293B] border border-[#334155] rounded-xl shadow-2xl p-4 z-50">
              <h4 className="text-white font-medium mb-2">Disconnect Account?</h4>
              <p className="text-sm text-slate-400 mb-4 leading-relaxed">This will stop syncing data from LinkedIn. Past conversations will remain.</p>
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 px-3 py-2 border border-[#334155] text-slate-300 rounded-md text-sm font-medium hover:bg-[#0F172A] transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    disconnect(account.id, { onSuccess: () => router.push('/accounts') })
                  }}
                  className="flex-1 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md text-sm font-medium transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Conversations', value: mockAnalytics.totalConversations, icon: MessageSquare, color: 'text-sky-500', bg: 'bg-sky-500/10' },
          { label: 'Messages Sent (30d)', value: mockAnalytics.totalMessagesSent, icon: Send, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Connections Sent (30d)', value: mockAnalytics.totalConnectionsSent, icon: Users, color: 'text-purple-500', bg: 'bg-purple-500/10' },
          { label: 'Response Rate', value: `${mockAnalytics.responseRate}%`, icon: Activity, color: 'text-amber-500', bg: 'bg-amber-500/10' },
        ].map((stat, i) => (
          <div key={i} className="bg-[#1E293B] border border-[#334155] rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <h3 className="text-slate-400 text-sm font-medium">{stat.label}</h3>
            </div>
            <p className="text-2xl font-bold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* 4. Recent Conversations */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-100">Recent Conversations</h2>
            <Link href={`/conversations?accountId=${account.id}`} className="text-sm font-medium text-sky-400 hover:text-sky-300 transition-colors">
              View all
            </Link>
          </div>
          
          <div className="bg-[#1E293B] border border-[#334155] rounded-xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0F172A] text-slate-400 border-b border-[#334155]">
                <tr>
                  <th className="px-5 py-3 font-medium">Contact</th>
                  <th className="px-5 py-3 font-medium">Last Message</th>
                  <th className="px-5 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#334155]">
                {/* Mock rows for UI */}
                {[
                  { id: '1', name: 'Alice Smith', message: 'Thanks for connecting!', time: new Date() },
                  { id: '2', name: 'Bob Jones', message: 'Can we jump on a call next week?', time: new Date(Date.now() - 3600000) },
                  { id: '3', name: 'Charlie Davis', message: 'I reviewed the proposal.', time: new Date(Date.now() - 86400000) },
                ].map((chat) => (
                  <tr key={chat.id} 
                      onClick={() => router.push(`/conversations/${chat.id}`)}
                      className="group hover:bg-[#0F172A] cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-4 w-48">
                      <span className="font-medium text-slate-200 group-hover:text-sky-400 transition-colors">{chat.name}</span>
                    </td>
                    <td className="px-5 py-4 text-slate-400 truncate max-w-[200px]">
                      {chat.message}
                    </td>
                    <td className="px-5 py-4 text-slate-500 whitespace-nowrap">
                      {formatRelativeTime(chat.time)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 5. Recent Activity */}
        <div>
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Recent Activity</h2>
          <div className="bg-[#1E293B] border border-[#334155] rounded-xl flex flex-col h-[400px]">
            <div className="flex-1 overflow-auto p-5 relative">
              <div className="absolute left-[33px] top-5 bottom-5 w-px bg-[#334155]" />
              
              <div className="space-y-6">
                {mockActivities.map((act) => (
                  <div key={act.id} className="flex gap-4 relative z-10">
                    <div className="w-7 h-7 rounded-full bg-[#0F172A] border border-[#334155] flex items-center justify-center shrink-0 mt-0.5">
                      {getActivityIcon(act.type)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200 leading-snug mb-1">{act.text}</p>
                      <p className="text-xs text-slate-500">{formatRelativeTime(act.time)}</p>
                    </div>
                  </div>
                ))}
            </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
