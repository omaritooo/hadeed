import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useDeleteHydration = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ success: boolean }, number, FetchError<{ statusMessage: string }>>({
    mutation: id => $api<{ success: boolean }>(`/api/hydration/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.hydration() }),
  })
}
