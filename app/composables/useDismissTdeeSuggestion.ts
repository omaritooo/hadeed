import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useDismissTdeeSuggestion = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- colada uses void for "no variables"
  return useMutation<{ success: boolean }, void, FetchError<{ statusMessage: string }>>({
    mutation: () => $api<{ success: boolean }>('/api/nutrition/tdee-estimate/dismiss', { method: 'POST' }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.tdeeEstimate() }),
  })
}
