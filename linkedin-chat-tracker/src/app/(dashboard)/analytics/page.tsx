'use client'

import { useState } from 'react'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useUIStore } from '@/store/uiStore'
import { StatsCard } from '@/components/analytics/StatsCard'
import { ActivityChart } from '@/components/analytics/ActivityChart'
import { FunnelChart } from '@/components/analytics/FunnelChart'
import { TopContactsTable } from '@/components/analytics/TopContactsTable'
import { formatRelativeTime } from '@/lib/utils'
import { Send, UserPlus, Reply, TrendingUp, Search, Bell, Check, Loader2, MousePointerClick } from 'lucide-react'

type Period = '7d' | '30d' | '90d' | 'all'

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30d')
  const [activityFilter, setActivityFilter] = useState<'All' | 'Messages' | 'Connections'>('All')
  
  const selectedAccountId = useUIStore(state => state.selectedAccountId)

  const { data, isLoading, isError } = useAnalytics(selectedAccountId, period)

  const getActivityIcon = (action: string) => {
    if (action.includes('MESSAGE')) return <Send className="w-4 h-4 text-sky-400" />
    if (action.includes('CONNECTION_SENT')) return <UserPlus className="w-4 h-4 text-violet-400" />
    if (action.includes('ACCEPTED')) return <Check className="w-4 h-4 text-emerald-400" />
    return <Bell className="w-4 h-4 text-slate-400" />
  }

  if (!selectedAccountId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0F172A]">
        <MousePointerClick className="w-12 h-12 text-slate-500 mb-4 opacity-50" />
        <h3 className="text-xl font-semibold text-slate-200 mb-2">No Account Selected</h3>
        <p className="text-slate-400 max-w-md">Please select an account from the sidebar or header to view analytics.</p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 mb-1">Analytics overview</h1>
          <p className="text-slate-400 text-sm">Measure your outreach performance</p>
        </div>

        <div className="flex items-center bg-[#1E293B] border border-[#334155] rounded-xl p-1">
          {(['7d', '30d', '90d', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                period === p 
                  ? 'bg-[#0F172A] text-sky-400 shadow-sm border border-[#334155]' 
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-64">
           <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
        </div>
      )}

      {isError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl">
           Failed to load analytics data.
        </div>
      )}

      {data && (
        <div className="space-y-6">
          
          {/* STATS ROW */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard 
              label="Messages Sent" 
              value={data.stats.totalMessagesSent} 
              icon={Send} 
              color="sky" 
            />
            <StatsCard 
              label="Connections Sent" 
              value={data.stats.totalConnectionsSent} 
              icon={UserPlus} 
              color="violet" 
            />
            <StatsCard 
              label="Replies Received" 
              value={data.stats.totalRepliesReceived} 
              icon={Reply} 
              color="emerald" 
            />
            <StatsCard 
              label="Response Rate" 
              value={`${data.stats.responseRate.toFixed(1)}%`} 
              icon={TrendingUp} 
              color="amber" 
            />
          </div>

          {/* ACTIVITY CHART */}
          <div className="bg-[#1E293B] border border-[#334155] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-100">Activity Over Time</h2>
              <span className="text-sm font-medium text-slate-400 bg-[#0F172A] px-3 py-1 rounded-full border border-[#334155]">
                {period === '7d' ? 'Last 7 Days' : period === '30d' ? 'Last 30 Days' : period === '90d' ? 'Last 90 Days' : 'All Time'}
              </span>
            </div>
            <ActivityChart data={data.dailySeries} period={period} />
          </div>

          {/* FUNNEL & CONTACTS ROW */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Outreach Funnel */}
            <div className="bg-[#1E293B] border border-[#334155] rounded-2xl p-6 hidden lg:block">
               <h2 className="text-lg font-semibold text-slate-100 mb-6">Outreach Funnel</h2>
               <FunnelChart 
                 sent={data.stats.totalMessagesSent + data.stats.totalConnectionsSent} 
                 replied={data.stats.totalRepliesReceived} 
                 accepted={data.stats.connectionsAccepted} 
               />
            </div>

            {/* Top Contacts */}
            <div className="lg:col-span-2 bg-[#1E293B] border border-[#334155] rounded-2xl p-6">
               <div className="flex items-center justify-between mb-6">
                 <h2 className="text-lg font-semibold text-slate-100">Top Contacts</h2>
               </div>
               <TopContactsTable contacts={data.topContacts} />
            </div>

          </div>

          {/* RECENT ACTIVITY */}
          <div className="bg-[#1E293B] border border-[#334155] rounded-2xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-[#334155] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
               <h2 className="text-lg font-semibold text-slate-100">Recent Activity</h2>
               <div className="flex gap-2">
                 {(['All', 'Messages', 'Connections'] as const).map(f => (
                   <button
                     key={f}
                     onClick={() => setActivityFilter(f)}
                     className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                       activityFilter === f
                         ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                         : 'bg-transparent text-slate-400 border-transparent hover:bg-[#0F172A]'
                     }`}
                   >
                     {f}
                   </button>
                 ))}
               </div>
            </div>

            <div className="overflow-x-auto">
              {data.activityLog.length === 0 ? (
                 <div className="p-8 text-center text-slate-500 text-sm">No recent activity</div>
              ) : (
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#0F172A]/50 text-slate-400 border-b border-[#334155]">
                    <tr>
                      <th className="px-6 py-3 font-medium w-[150px]">Date</th>
                      <th className="px-6 py-3 font-medium">Action</th>
                      <th className="px-6 py-3 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#334155]">
                    {data.activityLog
                      .filter(log => {
                        if (activityFilter === 'Messages') return log.action.includes('MESSAGE')
                        if (activityFilter === 'Connections') return log.action.includes('CONNECTION')
                        return true
                      })
                      .map((log) => (
                      <tr key={log.id} className="hover:bg-[#0F172A]/50 transition-colors">
                        <td className="px-6 py-4 text-slate-500 text-xs">
                          {formatRelativeTime(log.occurredAt)}
                        </td>
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-2">
                             <div className="w-6 h-6 rounded bg-[#0F172A] border border-[#334155] flex items-center justify-center">
                               {getActivityIcon(log.action)}
                             </div>
                             <span className="font-medium text-slate-300">
                               {log.action.replace(/_/g, ' ')}
                             </span>
                           </div>
                        </td>
                        <td className="px-6 py-4 text-slate-400 truncate max-w-md">
                           {log.metadata ? JSON.stringify(log.metadata) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
