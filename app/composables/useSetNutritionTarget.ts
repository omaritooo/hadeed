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
    onSuccess: () => {
      queryCache.invalidateQueries({ key: queryKeys.nutrition() })
      queryCache.invalidateQueries({ key: queryKeys.profile() })
    },
  })
}
