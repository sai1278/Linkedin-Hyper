import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, Trash2, Edit2, Check, Loader2, Sparkles } from 'lucide-react'

export interface MessageTemplate {
  id: string
  name: string
  type: 'MESSAGE' | 'CONNECTION_NOTE'
  body: string
  variables: string[]
  usageCount: number
}

interface TemplateLibraryProps {
  type: 'MESSAGE' | 'CONNECTION_NOTE'
  onSelect: (template: MessageTemplate) => void
}

export function TemplateLibrary({ type, onSelect }: TemplateLibraryProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  
  // Form State
  const [formName, setFormName] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formVariables, setFormVariables] = useState('')

  const { data: templates, isLoading } = useQuery<MessageTemplate[]>({
    queryKey: ['templates', type],
    queryFn: async () => {
      const res = await fetch(`/api/messages/templates?type=${type}`)
      if (!res.ok) throw new Error('Failed to fetch templates')
      return res.json()
    }
  })

  // Mutations
  const createMut = useMutation({
    mutationFn: async (data: Partial<MessageTemplate>) => {
      const res = await fetch('/api/messages/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, type })
      })
      if (!res.ok) throw new Error('Failed to create')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates', type] })
      resetForm()
    }
  })

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: string, data: Partial<MessageTemplate> }) => {
      const res = await fetch(`/api/messages/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error('Failed to update')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates', type] })
      resetForm()
    }
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/messages/templates/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates', type] })
  })

  const handleUseTemplate = (t: MessageTemplate) => {
    // Increment usage background
    updateMut.mutate({ id: t.id, data: { usageCount: t.usageCount + 1 } })
    onSelect(t)
  }

  const startEdit = (t: MessageTemplate) => {
    setEditingId(t.id)
    setFormName(t.name)
    setFormBody(t.body)
    setFormVariables(t.variables.join(', '))
    setIsCreating(true)
  }

  const resetForm = () => {
    setFormName('')
    setFormBody('')
    setFormVariables('')
    setEditingId(null)
    setIsCreating(false)
  }

  const saveForm = () => {
    if (!formName || !formBody) return
    const vars = formVariables.split(',').map(s => s.trim()).filter(Boolean)
    const payload = { name: formName, body: formBody, variables: vars }
    
    if (editingId) {
      updateMut.mutate({ id: editingId, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  const filtered = (templates || []).filter(t => 
    t.name.toLowerCase().includes(search.toLowerCase())
  )

  const highlightVariables = (body: string) => {
    // Basic replace to highlight text inside {braces}
    return body.split(/({[^}]+})/).map((part, i) => 
      part.startsWith('{') && part.endsWith('}') ? 
        <span key={i} className="text-sky-400 font-medium bg-sky-500/10 px-1 rounded">{part}</span> : part
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#1E293B] border border-[#334155] rounded-2xl overflow-hidden">
      
      {/* Header & Search */}
      <div className="p-4 border-b border-[#334155] bg-[#0F172A]/50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-sky-400" />
            {type === 'MESSAGE' ? 'Message Templates' : 'Connection Notes'}
          </h2>
          {!isCreating && (
            <button 
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-1.5 text-xs font-medium bg-sky-500 hover:bg-sky-600 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          )}
        </div>

        {!isCreating && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full bg-[#0F172A] border border-[#334155] rounded-xl pl-9 pr-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 max-h-[600px]">
        
        {/* Editor Form */}
        {isCreating && (
          <div className="bg-[#0F172A] border border-[#334155] rounded-xl p-4 mb-4 shadow-sm animate-in fade-in slide-in-from-top-2">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">{editingId ? 'Edit Template' : 'New Template'}</h3>
            <div className="space-y-3">
              <input 
                placeholder="Template Name e.g. First Touch"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                className="w-full bg-[#1E293B] border border-[#334155] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50"
              />
              <textarea 
                placeholder="Message body. Use {variable} for dynamic fields..."
                value={formBody}
                onChange={e => setFormBody(e.target.value)}
                rows={4}
                className="w-full bg-[#1E293B] border border-[#334155] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 resize-y"
              />
              <input 
                placeholder="Variables (comma separated) e.g. name, company"
                value={formVariables}
                onChange={e => setFormVariables(e.target.value)}
                className="w-full bg-[#1E293B] border border-[#334155] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button 
                  onClick={resetForm}
                  className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={saveForm}
                  disabled={!formName || !formBody || createMut.isPending || updateMut.isPending}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                >
                  {createMut.isPending || updateMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* List */}
        {!isCreating && isLoading && (
          <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 text-sky-500 animate-spin" /></div>
        )}

        {!isCreating && !isLoading && filtered.length === 0 && (
          <div className="text-center p-8 text-slate-500 text-sm">
            {search ? 'No templates match your search.' : 'No templates yet. Create your first one above.'}
          </div>
        )}

        {!isCreating && (
          <div className="space-y-3">
            {filtered.map(t => (
              <div key={t.id} className="bg-[#0F172A]/80 border border-[#334155] rounded-xl p-4 hover:border-[#475569] transition-all group">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200 leading-none">{t.name}</h3>
                    <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-medium">
                      Used {t.usageCount} times
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(t)} className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 rounded-md transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteMut.mutate(t.id)} className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors">
                      {deleteMut.isPending && deleteMut.variables === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                
                <div className="text-xs text-slate-400 leading-relaxed mb-4 line-clamp-3 bg-[#1E293B] p-3 rounded-lg border border-[#334155]/50">
                  {highlightVariables(t.body.slice(0, 150) + (t.body.length > 150 ? '...' : ''))}
                </div>

                <div className="flex justify-between items-center">
                  <div className="flex gap-1.5 flex-wrap">
                     {t.variables.map(v => (
                       <span key={v} className="text-[10px] font-medium bg-[#1E293B] border border-[#334155] text-slate-400 px-2 py-0.5 rounded-md">
                         {v}
                       </span>
                     ))}
                  </div>
                  <button 
                    onClick={() => handleUseTemplate(t)}
                    className="text-xs font-medium text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 px-3 py-1.5 rounded-lg transition-colors border border-sky-500/20"
                  >
                    Use Template
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
