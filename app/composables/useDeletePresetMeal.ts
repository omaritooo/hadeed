import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useDeletePresetMeal = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ success: boolean }, number, FetchError<{ statusMessage: string }>>({
    mutation: id => $api<{ success: boolean }>(`/api/nutrition/presets/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.presetMeals() }),
  })
}
