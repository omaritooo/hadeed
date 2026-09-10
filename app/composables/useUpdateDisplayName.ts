import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useUpdateDisplayName = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ displayName: string }, string, FetchError<{ statusMessage: string }>>({
    mutation: displayName => $api<{ displayName: string }>('/api/profile/display-name', {
      method: 'POST',
      body: { displayName },
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.profile() }),
  })
}
