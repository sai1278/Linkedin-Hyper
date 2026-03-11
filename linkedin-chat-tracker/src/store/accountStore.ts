import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AccountStore {
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  clearSelection: () => void;
}

export const useAccountStore = create<AccountStore>()(
  persist(
    (set) => ({
      selectedAccountId: null,
      setSelectedAccountId: (id) => set({ selectedAccountId: id }),
      clearSelection: () => set({ selectedAccountId: null }),
    }),
    {
      name: 'account-selection',
    }
  )
);
