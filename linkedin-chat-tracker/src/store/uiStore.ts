import { create } from 'zustand'

export interface UIStore {
  sidebarOpen: boolean
  selectedAccountId: string | null
  searchQuery: string
  activeConversationId: string | null

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSelectedAccount: (id: string | null) => void
  setSearchQuery: (q: string) => void
  setActiveConversation: (id: string | null) => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: false,
  selectedAccountId: null,
  searchQuery: '',
  activeConversationId: null,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSelectedAccount: (id) => set({ selectedAccountId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setActiveConversation: (id) => set({ activeConversationId: id }),
}))
