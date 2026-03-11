import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LinkedInAccount } from '@/types'

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

export function useConnectAccount() {
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to connect account')
      }
      return res.json() as Promise<{ authUrl: string }>
    },
    onSuccess: (data) => {
      window.open(data.authUrl, '_blank', 'width=600,height=700')
    }
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
      // In a real app we would use toast here: toast.success('Account disconnected')
    },
    onError: (error: Error) => {
      // toast.error(error.message)
      console.error(error.message)
    }
  })
}
