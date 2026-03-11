'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccounts, useDisconnectAccount } from '@/hooks/useAccounts'
import { AccountCard } from '@/components/accounts/AccountCard'
import { AccountConnectModal } from '@/components/accounts/AccountConnectModal'
import { MessageSquare, Plus, AlertCircle, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { toast } from 'sonner'

export default function AccountsPage() {
  const [showConnectModal, setShowConnectModal] = useState(false)
  const { data: accounts, isLoading, isError, error, refetch } = useAccounts()
  const { mutate: disconnect } = useDisconnectAccount()
  const searchParams = useSearchParams()

  useEffect(() => {
    const connected = searchParams.get('connected')
    const hasError = searchParams.get('error')

    if (connected === '1') {
      toast.success('LinkedIn account connected successfully')
    } else if (hasError === '1') {
      toast.error('Failed to connect LinkedIn account')
    }
  }, [searchParams])

  return (
    <div className="max-w-7xl mx-auto flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 mb-1">LinkedIn Accounts</h1>
          <p className="text-slate-400 text-sm">Manage your connected LinkedIn profiles</p>
        </div>
        <button
          onClick={() => setShowConnectModal(true)}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2.5 rounded-lg font-medium transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Connect LinkedIn Account
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-48 bg-[#1E293B] rounded-2xl border border-[#334155] animate-pulse p-5" />
          ))}
        </div>
      )}

      {/* Error State */}
      {isError && (
        <Alert variant="destructive" className="bg-red-900/20 border-red-900/50 text-red-400">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error fetching accounts</AlertTitle>
          <AlertDescription className="flex items-center gap-4">
            <span>{error instanceof Error ? error.message : 'Unknown error occurred'}</span>
            <button 
              onClick={() => refetch()} 
              className="text-white hover:underline text-sm font-medium ml-auto"
            >
              Try Again
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Empty State */}
      {!isLoading && !isError && accounts?.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#1E293B]/50 border border-[#334155] border-dashed rounded-2xl">
          <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6">
            <MessageSquare className="w-10 h-10 text-slate-500" />
          </div>
          <h3 className="text-xl font-semibold text-slate-200 mb-2">No LinkedIn accounts connected</h3>
          <p className="text-slate-400 max-w-sm mb-8">
            Connect your first account to start tracking conversations and managing your outreach.
          </p>
          <button
            onClick={() => setShowConnectModal(true)}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            <Plus className="w-5 h-5" />
            Connect LinkedIn Account
          </button>
        </div>
      )}

      {/* Accounts Grid */}
      {!isLoading && !isError && accounts && accounts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((account) => (
            <AccountCard 
              key={account.id} 
              account={account} 
              onDisconnect={() => disconnect(account.id)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showConnectModal && (
        <AccountConnectModal onClose={() => setShowConnectModal(false)} />
      )}
    </div>
  )
}
