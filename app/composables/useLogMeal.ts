import type { FetchError } from 'ofetch'
import type { MealLog } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface LogMealInput {
  name?: string | null
  items: { ingredientId: number, quantity: number }[]
}

export const useLogMeal = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<MealLog, LogMealInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<MealLog>('/api/nutrition', {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.nutrition() }),
  })
}
