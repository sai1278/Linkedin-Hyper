'use client'

import { useState } from 'react'
import { TemplateLibrary } from '@/components/compose/TemplateLibrary'
import { PeopleSearch, UnipileProfile } from '@/components/compose/PeopleSearch'
import { BulkSendPanel } from '@/components/compose/BulkSendPanel'
import { useAccounts } from '@/hooks/useAccounts'
import { useSendMessage } from '@/hooks/useMessages'
import { Send, Sparkles, AlertCircle, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'

export default function ComposePage() {
  const [activeTab, setActiveTab] = useState<'SINGLE' | 'BULK' | 'TEMPLATES'>('SINGLE')

  // Single Message State
  const [selectedContact, setSelectedContact] = useState<UnipileProfile | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [msgType, setMsgType] = useState<'message' | 'connection'>('message')
  const [msgText, setMsgText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  
  const { data: accounts } = useAccounts()
  const { mutate: sendMessage, isPending: isSending } = useSendMessage()

  const handleGenerateAI = async () => {
    if (!selectedContact || !selectedAccountId) return
    setIsGenerating(true)
    try {
      const res = await fetch('/api/messages/generate-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: selectedContact.name,
          recipientHeadline: selectedContact.headline,
          recipientCompany: selectedContact.default_company_name,
          senderName: accounts?.find(a => a.id === selectedAccountId)?.displayName || 'Me',
          type: msgType
        })
      })
      if (!res.ok) throw new Error('AI generation failed')
      const data = await res.json()
      setMsgText(data.text)
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate message')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSendSingle = () => {
    if (!selectedContact || !selectedAccountId || !msgText.trim()) return
    
    if (msgType === 'message') {
      sendMessage({
        accountId: selectedAccountId,
        profileUrl: selectedContact.provider_id,
        text: msgText
      }, {
        onSuccess: () => {
          setMsgText('')
          setSelectedContact(null)
          toast.success('Message sent successfully')
        }
      })
    } else {
      // Send connection note mock implementation
      fetch('/api/connect/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccountId,
          userId: selectedContact.provider_id,
          note: msgText
        })
      }).then(res => {
        if (res.ok) {
          setMsgText('')
          setSelectedContact(null)
          toast.success('Connection request sent')
        }
      })
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] -m-6 bg-[#0F172A]">
      
      {/* Top Tab Bar */}
      <div className="bg-[#1E293B] border-b border-[#334155] p-4 flex items-center gap-4 shrink-0 shadow-sm z-10">
        <h1 className="text-xl font-bold text-slate-100 mr-4">Compose</h1>
        <div className="flex bg-[#0F172A] p-1 rounded-xl border border-[#334155]">
          {(['SINGLE', 'BULK', 'TEMPLATES'] as const).map(tab => (
            <button
               key={tab}
               onClick={() => setActiveTab(tab)}
               className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                 activeTab === tab
                   ? 'bg-[#1E293B] text-sky-400 shadow-sm border border-[#334155]'
                   : 'text-slate-400 hover:text-slate-200 border border-transparent'
               }`}
            >
              {tab === 'SINGLE' ? 'Single Message' : tab === 'BULK' ? 'Bulk Campaign' : 'Templates Library'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        
        {/* SINGLE MESSAGE TAB */}
        {activeTab === 'SINGLE' && (
          <div className="flex h-full">
            <div className="w-80 flex-none hidden md:block">
              <PeopleSearch 
                accountId={selectedAccountId} 
                onSelect={(p) => setSelectedContact(p)} 
              />
            </div>
            
            <div className="flex-1 flex flex-col p-6 max-w-3xl border-l border-[#334155]">
               {!selectedContact ? (
                 <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                   <div className="w-20 h-20 bg-[#1E293B] border border-[#334155] rounded-full flex items-center justify-center mb-6">
                     <Search className="w-8 h-8 text-sky-500 opacity-50" />
                   </div>
                   <h2 className="text-xl font-semibold text-slate-200 mb-2">Select a recipient</h2>
                   <p className="text-slate-400 text-sm max-w-sm">Use the search panel on the left to find a connection or someone new to start drafting a message.</p>
                 </div>
               ) : (
                 <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-bottom-4">
                   
                   {/* Contact Header */}
                   <div className="bg-[#1E293B] border border-[#334155] rounded-2xl p-6 mb-6 flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full overflow-hidden bg-sky-900 border-2 border-slate-700 shrink-0 flex items-center justify-center">
                        {selectedContact.avatar_url ? (
                          <img src={selectedContact.avatar_url} alt={selectedContact.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-sky-300 font-bold text-xl">{selectedContact.name[0]}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <h2 className="text-xl font-bold text-slate-100 mb-1">{selectedContact.name}</h2>
                        <p className="text-sm text-slate-400 truncate">{selectedContact.headline || selectedContact.default_company_name || 'LinkedIn Member'}</p>
                      </div>
                      <button onClick={() => setSelectedContact(null)} className="text-xs text-sky-400 hover:underline">Change</button>
                   </div>

                   {/* Editor Form */}
                   <div className="bg-[#1E293B] border border-[#334155] rounded-2xl p-6 flex-1 flex flex-col">
                      
                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Send From</label>
                          <select 
                            value={selectedAccountId}
                            onChange={(e) => setSelectedAccountId(e.target.value)}
                            className="w-full bg-[#0F172A] border border-[#334155] rounded-xl px-4 py-2.5 text-sm font-medium text-slate-200 focus:outline-none focus:border-sky-500/50"
                          >
                            <option value="" disabled>Select Account...</option>
                            {accounts?.map(a => (
                              <option key={a.id} value={a.id}>{a.displayName}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Message Type</label>
                          <select 
                            value={msgType}
                            onChange={(e: any) => setMsgType(e.target.value)}
                            className="w-full bg-[#0F172A] border border-[#334155] rounded-xl px-4 py-2.5 text-sm font-medium text-slate-200 focus:outline-none focus:border-sky-500/50"
                          >
                            <option value="message">Standard Message</option>
                            <option value="connection">Connection Request Note</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col relative bg-[#0F172A] border border-[#334155] rounded-xl focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/50 transition-all p-1">
                        <textarea
                          value={msgText}
                          onChange={(e) => setMsgText(e.target.value)}
                          placeholder={`Start writing your ${msgType} to ${selectedContact.name.split(' ')[0]}...`}
                          className="w-full bg-transparent text-slate-200 text-sm placeholder:text-slate-500 resize-none outline-none leading-relaxed flex-1 p-3"
                        />
                        <div className="flex justify-between items-center p-3 border-t border-[#334155]/50 mt-auto">
                          <button
                            onClick={handleGenerateAI}
                            disabled={!selectedAccountId || isGenerating}
                            className="flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 px-3 py-1.5 rounded-lg transition-colors border border-violet-500/20 disabled:opacity-50"
                          >
                            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            Generate with AI
                          </button>
                          
                          <div className="flex items-center gap-4">
                            <span className="text-[10px] font-medium text-slate-500">{msgText.length} chars</span>
                            <button
                              onClick={handleSendSingle}
                              disabled={!selectedAccountId || !msgText.trim() || isSending}
                              className="w-10 h-10 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:bg-[#334155] disabled:text-slate-500 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all shadow-sm group"
                            >
                              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5 group-hover:scale-110 transition-transform" />}
                            </button>
                          </div>
                        </div>
                      </div>

                   </div>

                 </div>
               )}
            </div>
          </div>
        )}

        {/* BULK COMPAIGN TAB */}
        {activeTab === 'BULK' && <BulkSendPanel />}

        {/* TEMPLATES TAB */}
        {activeTab === 'TEMPLATES' && (
           <div className="p-6 h-full grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-y-auto">
             <div className="h-[600px] xl:h-full"><TemplateLibrary type="MESSAGE" onSelect={() => {}} /></div>
             <div className="h-[600px] xl:h-full"><TemplateLibrary type="CONNECTION_NOTE" onSelect={() => {}} /></div>
           </div>
        )}

      </div>
    </div>
  )
}
