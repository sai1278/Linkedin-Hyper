'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, CheckCircle2, AlertCircle, ClipboardPaste } from 'lucide-react'
import { toast } from 'sonner'

interface AccountConnectModalProps {
  onClose: () => void
}

type Step = 'form' | 'importing' | 'success' | 'error'

export function AccountConnectModal({ onClose }: AccountConnectModalProps) {
  const [step, setStep]             = useState<Step>('form')
  const [accountName, setName]      = useState('')
  const [cookieJson, setCookieJson] = useState('')
  const [errorMsg, setErrorMsg]     = useState('')
  const queryClient                 = useQueryClient()

  const handleImport = async () => {
    if (!accountName.trim()) {
      toast.error('Please enter an account name')
      return
    }

    let cookies: unknown[]
    try {
      cookies = JSON.parse(cookieJson.trim())
      if (!Array.isArray(cookies) || cookies.length === 0) throw new Error()
    } catch {
      toast.error('Invalid cookie JSON. Paste the exported array from Cookie-Editor.')
      return
    }

    setStep('importing')
    setErrorMsg('')

    try {
      const res = await fetch('/api/accounts/import-cookies', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accountName: accountName.trim(), cookies }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Import failed')
      }

      if (!data.verified) {
        toast.warning('Cookies imported but session verification failed. Your cookies may be expired.')
      }

      setStep('success')
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Import failed'
      setErrorMsg(msg)
      setStep('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#1E293B] border border-[#334155] rounded-xl w-full max-w-lg shadow-2xl p-6 relative">

        {step === 'form' && (
          <>
            <h2 className="text-xl font-semibold text-slate-100 mb-1">Add LinkedIn Account</h2>
            <p className="text-sm text-slate-400 mb-5">
              Import your LinkedIn cookies to connect an account without exposing your password.
            </p>

            {/* Instructions */}
            <div className="bg-[#0F172A] rounded-lg p-4 mb-5 text-sm text-slate-300 space-y-2">
              <p className="font-medium text-slate-200">How to get your cookies:</p>
              <ol className="list-decimal list-inside space-y-1 text-slate-400">
                <li>Install <span className="text-sky-400">Cookie-Editor</span> or <span className="text-sky-400">EditThisCookie</span> browser extension</li>
                <li>Log in to LinkedIn in your browser normally</li>
                <li>Open the extension on linkedin.com and click <span className="text-sky-400">Export → Export as JSON</span></li>
                <li>Paste the copied JSON below</li>
              </ol>
            </div>

            {/* Account name */}
            <input
              type="text"
              value={accountName}
              onChange={(e) => setName(e.target.value)}
              placeholder="Account name (e.g. Work, Personal)"
              className="w-full bg-[#0F172A] border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all mb-3"
            />

            {/* Cookie JSON paste */}
            <div className="relative mb-5">
              <ClipboardPaste className="absolute top-3 left-3 w-4 h-4 text-slate-500 pointer-events-none" />
              <textarea
                value={cookieJson}
                onChange={(e) => setCookieJson(e.target.value)}
                placeholder='Paste cookie JSON here: [{"name":"li_at","value":"..."},...]'
                rows={5}
                className="w-full bg-[#0F172A] border border-slate-700 text-slate-200 text-xs rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all resize-none font-mono"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-[#0F172A] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!accountName.trim() || !cookieJson.trim()}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                Import Cookies
              </button>
            </div>
          </>
        )}

        {step === 'importing' && (
          <div className="text-center py-10">
            <Loader2 className="w-10 h-10 text-sky-500 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Importing cookies...</h2>
            <p className="text-sm text-slate-400">Verifying your LinkedIn session. This takes ~15 seconds.</p>
          </div>
        )}

        {step === 'success' && (
          <div className="text-center py-10">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Account connected!</h2>
            <p className="text-sm text-slate-400 mb-6">Your LinkedIn session is active and ready.</p>
            <button
              onClick={onClose}
              className="px-8 py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center py-10">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Import failed</h2>
            <p className="text-sm text-red-400 mb-6">{errorMsg}</p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setStep('form')}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-[#0F172A] rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
