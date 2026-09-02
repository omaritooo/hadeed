import type { FetchError } from 'ofetch'
import type { MealLog } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useLogPresetMeal = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<MealLog, number, FetchError<{ statusMessage: string }>>({
    mutation: presetMealId => $api<MealLog>(`/api/nutrition/presets/${presetMealId}/log`, {
      method: 'POST',
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.nutrition() }),
  })
}
