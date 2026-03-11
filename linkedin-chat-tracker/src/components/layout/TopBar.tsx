'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Menu, Search, Bell, User, Settings, LogOut } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'

import { useAccounts } from '@/hooks/useAccounts'
import { useAllAccountsStats } from '@/hooks/useAnalytics'

interface TopBarProps {
  user?: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

export function TopBar({ user }: TopBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { toggleSidebar, selectedAccountId, setSelectedAccount, searchQuery, setSearchQuery } = useUIStore()
  
  const { data: accounts } = useAccounts()
  const { data: stats } = useAllAccountsStats()
  const unreadCount = stats?.unreadMessages || 0

  const [localSearch, setLocalSearch] = useState(searchQuery)

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearchQuery(localSearch)
      // Update URL silently
      const url = new URL(window.location.href)
      if (localSearch) {
        url.searchParams.set('q', localSearch)
      } else {
        url.searchParams.delete('q')
      }
      router.replace(url.pathname + url.search)
    }, 300)

    return () => clearTimeout(handler)
  }, [localSearch, setSearchQuery, router])

  const getPageTitle = () => {
    if (pathname.includes('/dashboard')) return 'Dashboard'
    if (pathname.includes('/accounts')) return 'Linked Accounts'
    if (pathname.includes('/conversations')) return 'Conversations'
    if (pathname.includes('/analytics')) return 'Analytics'
    if (pathname.includes('/compose')) return 'Compose Message'
    return 'Chat Tracker'
  }

  return (
    <header className="h-14 bg-[#1E293B] border-b border-[#334155] flex items-center justify-between px-4 shrink-0">
      
      {/* Left: Mobile menu & Title */}
      <div className="flex items-center gap-4 flex-1">
        <button 
          onClick={toggleSidebar}
          className="md:hidden text-slate-400 hover:text-slate-200"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-slate-100 hidden sm:block">
          {getPageTitle()}
        </h1>
      </div>

      {/* Center: Search */}
        <div className="relative group flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-sky-400 transition-colors" />
          <input 
            type="text"
            placeholder="Search conversations..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="w-full bg-[#0F172A] text-slate-200 border border-slate-700 rounded-full h-9 pl-9 pr-4 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all placeholder:text-slate-500"
          />
        </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-4 flex-1 justify-end">
        {/* Account Selector */}
        <select 
          className="bg-[#0F172A] border border-slate-700 text-sm rounded-md text-slate-200 h-9 px-3 focus:outline-none focus:border-sky-500 max-w-[150px] truncate hidden md:block"
          value={selectedAccountId || ''}
          onChange={(e) => setSelectedAccount(e.target.value || null)}
        >
          <option value="">All Accounts</option>
          {accounts?.map((acc: any) => (
            <option key={acc.id} value={acc.id}>{acc.displayName}</option>
          ))}
        </select>

        {/* Notifications */}
        <button className="relative text-slate-400 hover:text-slate-200 transition-colors">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* User Dropdown (Simplified for Phase 3) */}
        <div className="relative group cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center text-white text-sm font-semibold uppercase">
            {user?.name?.[0] || '?'}
          </div>
          
          {/* Dropdown Menu */}
          <div className="absolute right-0 top-full mt-2 w-48 bg-[#1E293B] rounded-md shadow-lg border border-[#334155] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
            <div className="py-1">
              <div className="px-4 py-2 border-b border-[#334155]">
                <p className="text-sm font-medium text-slate-200 truncate">{user?.name}</p>
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              </div>
              <button onClick={() => {}} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-[#0F172A] hover:text-slate-100">
                <User className="w-4 h-4" /> Profile
              </button>
              <button onClick={() => {}} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-[#0F172A] hover:text-slate-100">
                <Settings className="w-4 h-4" /> Settings
              </button>
              <button onClick={() => signOut()} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-[#0F172A] hover:text-red-300 border-t border-[#334155] mt-1 space-y-1">
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
