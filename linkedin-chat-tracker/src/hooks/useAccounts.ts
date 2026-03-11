import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LinkedInAccount } from '@/types'
import { toast } from 'sonner'

export function useAccounts() {
  return useQuery<LinkedInAccount[]>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed to fetch accounts')
      return res.json()
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useAccount(id: string) {
  return useQuery<LinkedInAccount>({
    queryKey: ['accounts', id],
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${id}`)
      if (!res.ok) throw new Error('Failed to fetch account')
      return res.json()
    },
    enabled: !!id,
    staleTime: 60_000,
  })
}

// useConnectAccount is no longer used — cookie import is handled
// directly in AccountConnectModal via POST /api/accounts/import-cookies.
// Kept as a no-op export to avoid breaking any existing imports.
export function useConnectAccount() {
  return useMutation({
    mutationFn: async (_data: { name: string }) => {
      // Handled by AccountConnectModal directly
      return { success: true }
    },
  })
}

export function useDisconnectAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/accounts/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to disconnect account')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      toast.success('Account disconnected')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to disconnect account')
    }
  })
}
