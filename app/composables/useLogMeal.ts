import type { FetchError } from 'ofetch'
import type { MealLog, MealType } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface LogMealInput {
  name?: string | null
  // Omit to let the server infer breakfast/lunch/dinner/snack from the current time of day.
  mealType?: MealType
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
    onSuccess: () => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.nutrition() }),
      queryCache.invalidateQueries({ key: queryKeys.tdeeEstimate() }),
    ]),
  })
}
