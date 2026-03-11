import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Loader2, User, RefreshCw, MessageSquare } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'

export interface UnipileProfile {
  provider_id: string
  name: string
  headline?: string
  avatar_url?: string
  default_company_name?: string
}

interface PeopleSearchProps {
  accountId?: string | null
  onSelect: (profile: UnipileProfile) => void
}

export function PeopleSearch({ accountId, onSelect }: PeopleSearchProps) {
  const [localSearch, setLocalSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(localSearch)
    }, 500)
    return () => clearTimeout(handler)
  }, [localSearch])

  // Search Query
  const { data: searchResults, isLoading: isSearching } = useQuery<UnipileProfile[]>({
    queryKey: ['people-search', accountId, debouncedSearch],
    queryFn: async () => {
      const res = await fetch(`/api/people/search?q=${debouncedSearch}&accountId=${accountId}`)
      if (!res.ok) throw new Error('Search failed')
      return res.json()
    },
    enabled: !!accountId && debouncedSearch.length >= 2,
    staleTime: 60000 
  })

  // Recent Contacts Query (from existing conversations endpoint)
  const { data: recentRes, isLoading: isRecentLoading } = useQuery({
    queryKey: ['conversations', accountId, 'recent'],
    queryFn: async () => {
      const res = await fetch(`/api/conversations?accountId=${accountId}&limit=5`)
      if (!res.ok) throw new Error('Failed fetch')
      return res.json()
    },
    enabled: !!accountId && debouncedSearch.length < 2,
  })

  const recentContacts = recentRes?.conversations || []

  return (
    <div className="flex flex-col h-full bg-[#1E293B] border-r border-[#334155]">
      
      {/* Search Bar */}
      <div className="p-4 border-b border-[#334155] bg-[#0F172A]/50 shrink-0">
        <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <Search className="w-4 h-4 text-sky-400" /> Let's find someone
        </h2>
        <div className="relative">
          {isSearching ? (
             <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sky-500 animate-spin" />
          ) : (
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          )}
          <input 
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search by name..."
            disabled={!accountId}
            className="w-full bg-[#0F172A] border border-[#334155] rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
          />
        </div>
        {!accountId && (
          <p className="text-[10px] text-rose-400 mt-2 font-medium">Select an account in the right panel first.</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        
        {/* State: Prompt */}
        {debouncedSearch.length > 0 && debouncedSearch.length < 2 && (
          <div className="p-6 text-center text-slate-500 text-sm">
            Please enter at least 2 characters.
          </div>
        )}

        {/* State: Search Results */}
        {debouncedSearch.length >= 2 && !isSearching && searchResults?.length === 0 && (
          <div className="p-6 text-center text-slate-500 text-sm">
            No results found for "{debouncedSearch}"
          </div>
        )}

        {debouncedSearch.length >= 2 && searchResults && searchResults.length > 0 && (
          <div className="p-2">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-3 py-2 mb-1">
              Search Results
            </h3>
            <div className="space-y-1">
              {searchResults.map(profile => (
                <div key={profile.provider_id} className="p-3 hover:bg-[#0F172A] rounded-xl transition-colors group flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-sky-900 overflow-hidden shrink-0 border border-slate-700 flex items-center justify-center text-sky-300 font-semibold text-sm">
                     {profile.avatar_url ? (
                       <img src={profile.avatar_url} alt={profile.name} className="w-full h-full object-cover" />
                     ) : profile.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-200 text-sm truncate">{profile.name}</p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{profile.headline || profile.default_company_name}</p>
                  </div>
                  <button 
                    onClick={() => onSelect(profile)}
                    className="opacity-0 group-hover:opacity-100 bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* State: Recent Contacts */}
        {debouncedSearch.length < 2 && (
          <div className="p-2">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-3 py-2 mb-1 mt-2 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Recently Messaged
            </h3>
            
            {isRecentLoading ? (
              <div className="p-4 flex justify-center"><Loader2 className="w-5 h-5 text-slate-500 animate-spin" /></div>
            ) : recentContacts.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">No recent contacts found.</div>
            ) : (
              <div className="space-y-1">
                {recentContacts.map((conv: any) => (
                   <div key={conv.id} className="p-3 hover:bg-[#0F172A] rounded-xl transition-colors group flex items-start gap-3">
                     <div className="w-10 h-10 rounded-full bg-[#1E293B] overflow-hidden shrink-0 border border-[#334155] flex items-center justify-center text-slate-400 text-sm">
                       {conv.contact.avatarUrl ? (
                         <img src={conv.contact.avatarUrl} alt={conv.contact.fullName} className="w-full h-full object-cover" />
                       ) : <User className="w-5 h-5" />}
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="font-medium text-slate-200 text-sm">{conv.contact.fullName}</p>
                       <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                         <MessageSquare className="w-3 h-3" /> {formatRelativeTime(conv.lastMessageAt || new Date().toISOString())}
                       </p>
                     </div>
                     <button 
                       onClick={() => onSelect({
                         provider_id: conv.contact.profileUrl, // proxying profile_url as provider_id for the compose box
                         name: conv.contact.fullName,
                         headline: conv.contact.headline,
                         avatar_url: conv.contact.avatarUrl
                       })}
                       className="opacity-0 group-hover:opacity-100 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 text-[10px] font-medium px-2 py-1.5 rounded-md transition-all border border-sky-500/20"
                     >
                       Message Again
                     </button>
                   </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
