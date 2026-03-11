'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { LayoutDashboard, Users, MessageSquare, BarChart3, PenSquare, LogOut, X } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

interface SidebarProps {
  user?: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Accounts', href: '/accounts', icon: Users },
  { name: 'Conversations', href: '/conversations', icon: MessageSquare },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Compose', href: '/compose', icon: PenSquare },
]

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname()
  const { sidebarOpen, setSidebarOpen } = useUIStore()

  return (
    <>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-60 bg-[#1E293B] border-r border-[#334155] transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 flex flex-col",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Top brand area */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-[#334155]">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="bg-sky-500/10 p-1.5 rounded-full">
              <MessageSquare className="w-5 h-5 text-sky-500" />
            </div>
            <span className="font-semibold text-slate-100">Chat Tracker</span>
          </Link>
          <button 
            className="md:hidden text-slate-400 hover:text-slate-200"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-sky-500/10 text-sky-400 border-l-2 border-sky-500 ml-[-2px] pl-[14px]" 
                    : "text-slate-400 hover:bg-[#0F172A] hover:text-slate-200"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            )
          })}
        </nav>

        {/* Bottom user profile area */}
        <div className="p-4 border-t border-[#334155]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-sky-600 flex items-center justify-center text-white font-semibold uppercase shrink-0">
              {user?.name?.[0] || user?.email?.[0] || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{user?.name}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>
          <button 
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-slate-400 hover:bg-[#0F172A] hover:text-slate-200 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
