import type { FetchError } from 'ofetch'
import { useMutation } from '@pinia/colada'

export const useLogout = () => {
  const { $api } = useNuxtApp()

  return useMutation<{ success: boolean }, void, FetchError<{ statusMessage: string }>>({
    mutation: () => $api<{ success: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),
  })
}
