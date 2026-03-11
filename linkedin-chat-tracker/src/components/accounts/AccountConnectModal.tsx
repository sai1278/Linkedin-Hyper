import { useState, useEffect } from 'react'
import { useConnectAccount } from '@/hooks/useAccounts'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

interface AccountConnectModalProps {
  onClose: () => void
}

export function AccountConnectModal({ onClose }: AccountConnectModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [name, setName] = useState('')
  const { mutate, isPending } = useConnectAccount()
  const queryClient = useQueryClient()
  const [pollCount, setPollCount] = useState(0)

  useEffect(() => {
    let interval: NodeJS.Timeout

    if (step === 3) {
      interval = setInterval(async () => {
        setPollCount((c) => c + 1)
        if (pollCount > 30) {
          // Timeout after ~90 seconds
          clearInterval(interval)
          alert('Connection timed out. Please try again.')
          setStep(1)
          return
        }

        try {
          const res = await fetch('/api/accounts')
          if (res.ok) {
            const accounts = await res.json()
            const exists = accounts.find((a: any) => a.displayName === name || a.name === name)
            if (exists) {
              clearInterval(interval)
              setStep(4)
            }
          }
        } catch (e) {
          console.error(e)
        }
      }, 3000)
    }

    return () => clearInterval(interval)
  }, [step, pollCount, name])

  const handleConnect = () => {
    if (!name.trim()) return
    setStep(2)
    mutate({ name }, {
      onSuccess: () => {
        setStep(3)
      },
      onError: () => {
        setStep(1)
        alert('Failed to initialize connection')
      }
    })
  }

  const handleDone = () => {
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#1E293B] border border-[#334155] rounded-xl w-full max-w-md shadow-2xl p-6 relative">
        {(step === 1 || step === 2) && (
          <>
            <h2 className="text-xl font-semibold text-slate-100 mb-1">Add Account</h2>
            <p className="text-sm text-slate-400 mb-6">Give this account a name (e.g. Work, Personal)</p>
            
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Account Name"
              className="w-full bg-[#0F172A] border fill-white border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all mb-6"
            />

            <div className="flex justify-end gap-3 hover:cursor-pointer">
              <button 
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-[#0F172A] rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleConnect}
                disabled={!name.trim() || isPending || step === 2}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center"
              >
                {(isPending || step === 2) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {step === 2 ? 'Connecting...' : 'Connect via LinkedIn'}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <div className="text-center py-8">
            <Loader2 className="w-10 h-10 text-sky-500 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Waiting for LinkedIn authorization...</h2>
            <p className="text-sm text-slate-400">Complete the sign-in in the popup window</p>
          </div>
        )}

        {step === 4 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100 mb-6">Account connected successfully!</h2>
            <button 
              onClick={handleDone}
              className="px-8 py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg transition-colors inline-flex justify-center"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
