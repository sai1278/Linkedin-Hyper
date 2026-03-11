import { LinkedInAccount } from '@/types'
import { formatRelativeTime } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface AccountCardProps {
  account: LinkedInAccount
  onDisconnect: (id: string) => void
}

export function AccountCard({ account, onDisconnect }: AccountCardProps) {
  const router = useRouter()
  const [showConfirm, setShowConfirm] = useState(false)

  const statusStyles = {
    ACTIVE: 'bg-emerald-500/15 text-emerald-400',
    DISCONNECTED: 'bg-red-500/15 text-red-400',
    ERROR: 'bg-amber-500/15 text-amber-400',
  }

  return (
    <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-5 hover:border-sky-500/40 hover:shadow-lg hover:shadow-sky-500/5 transition-all duration-200 flex flex-col h-full relative">
      
      {/* Top row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-[#0F172A] flex items-center justify-center shrink-0 border border-[#334155]">
            {account.profilePicUrl ? (
              <img src={account.profilePicUrl} alt={account.displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-slate-400 font-semibold text-lg">{account.displayName[0]?.toUpperCase()}</span>
            )}
          </div>
          <div>
            <h3 className="text-white font-bold leading-none mb-1.5">{account.displayName}</h3>
            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[account.status]}`}>
              {account.status === 'ACTIVE' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              {account.status}
            </div>
          </div>
        </div>
      </div>

      {/* Middle */}
      <div className="text-sm text-slate-400 mb-4">
        {account.lastSyncAt ? `Synced ${formatRelativeTime(account.lastSyncAt)}` : 'Never synced'}
      </div>

      {/* Bottom stats */}
      <div className="flex items-center gap-4 text-sm mt-auto mb-5 border-t border-[#334155] border-b py-3">
        <div className="flex-1 text-center border-r border-[#334155]">
          <div className="text-slate-400 text-xs mb-1">Conversations</div>
          <div className="text-slate-200 font-semibold">{account._count?.conversations || 0}</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-slate-400 text-xs mb-1">Unread</div>
          <div className="text-sky-400 font-semibold">0</div> {/* Placeholder unread count */}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button 
          onClick={() => router.push(`/accounts/${account.id}`)}
          className="flex-1 px-4 py-2 border border-sky-500/50 text-sky-400 rounded-md text-sm font-medium hover:bg-sky-500/10 transition-colors"
        >
          View Details
        </button>
        <button 
          onClick={() => setShowConfirm(true)}
          className="px-4 py-2 bg-red-500/10 text-red-400 rounded-md text-sm font-medium hover:bg-red-500/20 transition-colors"
        >
          Disconnect
        </button>
      </div>

      {/* AlertDialog replacement */}
      {showConfirm && (
        <div className="absolute inset-0 bg-[#1E293B]/95 z-10 rounded-2xl flex flex-col items-center justify-center p-5 text-center backdrop-blur-sm border border-[#334155]">
          <h4 className="text-white font-semibold mb-2">Disconnect Account?</h4>
          <p className="text-sm text-slate-400 mb-4">Are you sure you want to disconnect {account.displayName}?</p>
          <div className="flex gap-3 w-full">
            <button 
              onClick={() => setShowConfirm(false)}
              className="flex-1 px-3 py-2 border border-[#334155] text-slate-300 rounded-md text-sm font-medium hover:bg-[#0F172A] transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={() => {
                setShowConfirm(false)
                onDisconnect(account.id)
              }}
              className="flex-1 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md text-sm font-medium transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
