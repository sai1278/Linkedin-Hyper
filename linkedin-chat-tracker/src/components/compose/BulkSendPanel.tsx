import { useState, useRef, useEffect } from 'react'
import Papa from 'papaparse'
import { useQuery } from '@tanstack/react-query'
import { TemplateLibrary, MessageTemplate } from './TemplateLibrary'
import { useAccounts } from '@/hooks/useAccounts'
import { UploadCloud, CheckCircle2, AlertCircle, Sparkles, Loader2, ArrowRight } from 'lucide-react'

interface Recipient {
  profileUrl: string
  name?: string
  company?: string
  topic?: string
}

export function BulkSendPanel() {
  const { data: accounts } = useAccounts()
  
  // Step 1: Upload
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  
  // Step 2: Configure
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [configTab, setConfigTab] = useState<'WRITE' | 'TEMPLATE'>('WRITE')
  const [message, setMessage] = useState('')
  const [useAI, setUseAI] = useState(false)
  const [aiCustomContext, setAiCustomContext] = useState('')
  const [previewMessages, setPreviewMessages] = useState<string[]>([])
  
  // Step 3: Job
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<any>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Polling Job Status
  useEffect(() => {
    if (!jobId || jobStatus?.status === 'complete' || jobStatus?.status === 'failed') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/campaigns/bulk/${jobId}`)
        if (res.ok) {
          const data = await res.json()
          setJobStatus(data)
        }
      } catch (e) {}
    }, 2000)
    return () => clearInterval(interval)
  }, [jobId, jobStatus?.status])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as any[]
        if (data.length === 0) {
          setUploadError('CSV file is empty')
          return
        }
        
        // Find profile url column
        const headers = Object.keys(data[0]).map(h => h.toLowerCase().trim())
        const urlKey = Object.keys(data[0]).find(k => k.toLowerCase().includes('url') || k.toLowerCase().includes('profile'))
        
        if (!urlKey) {
          setUploadError('Could not find a column for Profile URL. Please ensure your CSV has a "profileUrl" column.')
          return
        }

        const parsed: Recipient[] = data.map(row => {
          // Best effort mapping
          const url = row[urlKey]
          const nameKey = Object.keys(row).find(k => k.toLowerCase().includes('name'))
          const compKey = Object.keys(row).find(k => k.toLowerCase().includes('company'))
          const topicKey = Object.keys(row).find(k => k.toLowerCase().includes('topic') || k.toLowerCase().includes('context'))

          return {
            profileUrl: url,
            name: nameKey ? row[nameKey] : '',
            company: compKey ? row[compKey] : '',
            topic: topicKey ? row[topicKey] : ''
          }
        }).filter(r => !!r.profileUrl)

        if (parsed.length > 100) {
          setUploadError(`Maximum 100 recipients allowed. Your CSV has ${parsed.length}.`)
          return
        }

        setRecipients(parsed)
        setUploadError(null)
      },
      error: (err) => {
        setUploadError('Failed to parse CSV: ' + err.message)
      }
    })
  }

  const handleTemplateSelect = (t: MessageTemplate) => {
    setMessage(t.body)
  }

  const handleGeneratePreview = async () => {
    if (!recipients.length || !selectedAccountId) return
    if (!useAI) {
      // Basic interpolation
      const previews = recipients.slice(0, 2).map(r => {
        return message.replace(/{name}/g, r.name || '{name}')
                      .replace(/{company}/g, r.company || '{company}')
      })
      setPreviewMessages(previews)
      return
    }

    // AI Preview
    try {
      setPreviewMessages(['Generating...'])
      const promises = recipients.slice(0, 2).map(async r => {
        const res = await fetch('/api/messages/generate-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
             recipientName: r.name || 'Friend',
             recipientCompany: r.company,
             senderName: accounts?.find(a => a.id === selectedAccountId)?.displayName || 'Me',
             topic: r.topic || aiCustomContext || message,
             type: 'message'
          })
        })
        if (!res.ok) throw new Error('Preview generation failed')
        const data = await res.json()
        return data.text
      })

      const results = await Promise.all(promises)
      setPreviewMessages(results)
    } catch (e: any) {
      setPreviewMessages(['Failed to generate preview: ' + e.message])
    }
  }

  const handleStartCampaign = async () => {
    if (!selectedAccountId || !recipients.length || !message) {
      alert('Please complete all configuration steps')
      return
    }
    
    // Add custom context to message if AI is used and no template is selected
    const finalMessage = useAI && aiCustomContext ? aiCustomContext + '\n\n' + message : message

    try {
      const res = await fetch('/api/campaigns/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccountId,
          recipients,
          message: finalMessage,
          useAI
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error)
      }

      const data = await res.json()
      setJobId(data.jobId)
      setJobStatus({ status: 'running', sent: 0, failed: 0, total: recipients.length })
    } catch (e: any) {
      alert('Campaign start failed: ' + e.message)
    }
  }

  const reset = () => {
    setRecipients([])
    setUploadError(null)
    setMessage('')
    setJobId(null)
    setJobStatus(null)
  }

  if (jobId && jobStatus) {
    const progress = Math.round(((jobStatus.sent + jobStatus.failed) / jobStatus.total) * 100)
    const isDone = jobStatus.status === 'complete' || jobStatus.status === 'failed'

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-lg bg-[#1E293B] border border-[#334155] rounded-2xl p-8 text-center shadow-xl">
          <div className="w-20 h-20 rounded-full bg-[#0F172A] border border-[#334155] flex items-center justify-center mx-auto mb-6">
            {!isDone ? (
              <Loader2 className="w-10 h-10 text-sky-500 animate-spin" />
            ) : (
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            )}
          </div>
          
          <h2 className="text-xl font-bold text-slate-100 mb-2">
            {!isDone ? 'Sending Campaign...' : 'Campaign Complete'}
          </h2>
          <p className="text-slate-400 text-sm mb-8">
            {isDone ? 'Your messages have been processed.' : 'Do not close this page while messages are sending.'}
          </p>

          <div className="mb-2 flex justify-between text-sm font-medium">
            <span className="text-slate-300">Progress</span>
            <span className="text-sky-400">{progress}%</span>
          </div>
          
          <div className="w-full h-3 bg-[#0F172A] rounded-full overflow-hidden mb-8 border border-[#334155]">
            <div 
              className="h-full bg-sky-500 transition-all duration-500" 
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-[#0F172A] p-4 rounded-xl border border-[#334155]">
               <div className="text-2xl font-bold text-emerald-400 mb-1">{jobStatus.sent}</div>
               <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Sent</div>
            </div>
            <div className="bg-[#0F172A] p-4 rounded-xl border border-[#334155]">
               <div className="text-2xl font-bold text-rose-400 mb-1">{jobStatus.failed}</div>
               <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Failed</div>
            </div>
          </div>

          {isDone && (
            <button onClick={reset} className="w-full py-3 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-medium transition-colors">
              Start New Campaign
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden bg-[#0F172A]">
      
      {/* Configuration Column */}
      <div className="flex-1 lg:max-w-xl border-r border-[#334155] bg-[#1E293B] flex flex-col overflow-y-auto">
        
        {/* Step 1 */}
        <div className="p-6 border-b border-[#334155]">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 text-xs flex items-center justify-center font-bold">1</span>
            Upload Leads
          </h2>
          
          {recipients.length === 0 ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#475569] hover:border-sky-500 bg-[#0F172A]/50 hover:bg-sky-500/5 rounded-2xl p-8 text-center cursor-pointer transition-colors"
            >
              <UploadCloud className="w-10 h-10 text-slate-500 mx-auto mb-4" />
              <p className="text-sm font-medium text-slate-300">Click to upload CSV</p>
              <p className="text-xs text-slate-500 mt-2">Requires column: profileUrl. Optional: name, company, topic.</p>
              <input 
                type="file" 
                ref={fileInputRef} 
                accept=".csv" 
                className="hidden" 
                onChange={handleFileUpload} 
              />
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-[#334155] rounded-xl p-4">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="font-semibold text-slate-200">{recipients.length} Row{recipients.length !== 1 && 's'} Loaded</span>
                </div>
                <button onClick={() => setRecipients([])} className="text-xs text-slate-400 hover:text-slate-200">Remove</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-400 whitespace-nowrap">
                  <thead>
                     <tr className="border-b border-[#334155]">
                       <th className="pb-2 pr-4 font-medium">Name</th>
                       <th className="pb-2 pr-4 font-medium">Company</th>
                       <th className="pb-2 font-medium">URL</th>
                     </tr>
                  </thead>
                  <tbody>
                    {recipients.slice(0, 3).map((r, i) => (
                      <tr key={i} className="border-b border-[#334155]/50 last:border-0">
                         <td className="py-2 pr-4 text-slate-300 truncate max-w-[100px]">{r.name || '—'}</td>
                         <td className="py-2 pr-4 truncate max-w-[100px]">{r.company || '—'}</td>
                         <td className="py-2 truncate max-w-[150px]">{r.profileUrl}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {recipients.length > 3 && <div className="text-xs text-sky-400 mt-2 text-center">+ {recipients.length - 3} more rows</div>}
            </div>
          )}
          
          {uploadError && (
             <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-2 text-rose-400 text-sm">
               <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
               <p>{uploadError}</p>
             </div>
          )}
        </div>

        {/* Step 2 */}
        <div className="p-6 border-b border-[#334155] flex-1">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 text-xs flex items-center justify-center font-bold">2</span>
            Message & Settings
          </h2>

          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Send From</label>
              <select 
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-xl px-4 py-2.5 text-sm font-medium text-slate-200 focus:outline-none focus:border-sky-500/50"
              >
                <option value="" disabled>Select Outbound Account...</option>
                {accounts?.map(a => (
                  <option key={a.id} value={a.id}>{a.displayName}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center gap-1 mb-3">
                <button
                  onClick={() => setConfigTab('WRITE')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
                    configTab === 'WRITE' ? "bg-[#0F172A] border-[#334155] text-sky-400 shadow-sm" : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Write Message
                </button>
                <button
                  onClick={() => setConfigTab('TEMPLATE')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
                    configTab === 'TEMPLATE' ? "bg-[#0F172A] border-[#334155] text-sky-400 shadow-sm" : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Use Template
                </button>
              </div>

              {configTab === 'WRITE' ? (
                <textarea 
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Write your message here. Use {name} or {company} to insert variables."
                  className="w-full h-32 bg-[#0F172A] border border-[#334155] rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 resize-y"
                />
              ) : (
                <div className="h-64 border border-[#334155] rounded-xl overflow-hidden bg-[#0F172A]">
                  <TemplateLibrary type="MESSAGE" onSelect={handleTemplateSelect} />
                </div>
              )}
            </div>

            <div className="bg-[#0F172A]/50 border border-violet-500/20 rounded-xl p-4">
              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2 text-violet-400 font-medium text-sm">
                  <Sparkles className="w-4 h-4" /> Personalize with AI
                </div>
                <div className="relative inline-block w-10 mt-1 align-middle select-none transition duration-200 ease-in">
                  <input type="checkbox" checked={useAI} onChange={() => setUseAI(!useAI)} className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 border-slate-700 appearance-none cursor-pointer" style={{ right: useAI ? '0' : 'auto', left: !useAI ? '0' : 'auto', borderColor: useAI ? '#8B5CF6' : '#334155' }}/>
                  <label className={`toggle-label block overflow-hidden h-5 rounded-full cursor-pointer ${useAI ? 'bg-violet-500' : 'bg-slate-700'}`}></label>
                </div>
              </label>
              
              {useAI && (
                <div className="mt-3">
                  <input 
                    value={aiCustomContext}
                    onChange={e => setAiCustomContext(e.target.value)}
                    placeholder="E.g. Mention we both attended the recent marketing summit..."
                    className="w-full bg-[#1E293B] border border-violet-500/30 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
                  />
                  <p className="text-[10px] text-violet-400/70 mt-2 leading-relaxed">
                    AI will combine this context, the recipient's column data, and your base message structure to generate a unique note for each person.
                  </p>
                </div>
              )}
            </div>
            
            <button
               onClick={handleGeneratePreview}
               className="text-xs font-medium text-sky-400 hover:text-sky-300 flex items-center gap-1.5"
            >
               <ArrowRight className="w-3.5 h-3.5" /> Generate Preview
            </button>
          </div>
        </div>
      </div>

      {/* Preview Column */}
      <div className="flex-1 flex flex-col p-6 bg-[#0F172A]">
        <h2 className="text-lg font-semibold text-slate-100 mb-6 flex items-center justify-between">
          <span>Review & Send</span>
          <span className="text-xs font-bold text-sky-400 bg-sky-500/10 px-3 py-1 rounded-full uppercase tracking-wider">Step 3</span>
        </h2>

        <div className="flex-1 overflow-y-auto min-h-0 mb-6">
          <div className="space-y-4">
             {previewMessages.length === 0 ? (
               <div className="border border-[#334155] border-dashed rounded-xl p-8 text-center bg-[#1E293B]/50">
                 <p className="text-slate-400 text-sm">Configure your message and click "Generate Preview" to see how messages will look.</p>
               </div>
             ) : (
               previewMessages.map((msg, i) => (
                 <div key={i} className="bg-[#1E293B] border border-[#334155] rounded-2xl p-4 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                   <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#334155]">
                     <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Preview {i + 1}</div>
                     <span className="text-xs text-sky-400 font-medium">To: {recipients[i]?.name || 'Unknown'}</span>
                   </div>
                   <p className="text-sm text-slate-200 whitespace-pre-wrap">{msg}</p>
                 </div>
               ))
             )}
          </div>
        </div>

        <div className="pt-6 border-t border-[#334155]">
          <button
             onClick={handleStartCampaign}
             disabled={!selectedAccountId || !recipients.length || !message.trim()}
             className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-[#334155] disabled:text-slate-500 text-white rounded-xl font-bold transition-all shadow-sm hover:shadow-emerald-500/20 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
             Start Campaign <ArrowRight className="w-5 h-5" />
          </button>
          <p className="text-center text-xs text-slate-500 mt-3">Messages will be queued and sent gradually to avoid rate limits.</p>
        </div>
      </div>
      
    </div>
  )
}
