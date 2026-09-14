import type { FetchError } from 'ofetch'
import type { MacroTarget } from '~~/shared/types/split.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useSetNutritionTarget = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ target: MacroTarget | null }, MacroTarget | null, FetchError<{ statusMessage: string }>>({
    mutation: target => $api<{ target: MacroTarget | null }>('/api/nutrition/target', {
      method: 'POST',
      body: { target },
    }),
    // Returning the promise keeps the mutation loading until nutrition/profile have refetched,
    // so buttons don't re-enable over stale data. The estimate refetch is fire-and-forget.
    onSuccess: () => {
      queryCache.invalidateQueries({ key: queryKeys.tdeeEstimate() }).catch(() => {})
      return Promise.all([
        queryCache.invalidateQueries({ key: queryKeys.nutrition() }),
        queryCache.invalidateQueries({ key: queryKeys.profile() }),
      ])
    },
  })
}
