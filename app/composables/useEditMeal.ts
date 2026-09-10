import type { FetchError } from 'ofetch'
import type { MealLog } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface EditMealInput {
  id: number
  items: { ingredientId: number, quantity: number }[]
}

export const useEditMeal = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<MealLog, EditMealInput, FetchError<{ statusMessage: string }>>({
    mutation: ({ id, items }) => $api<MealLog>(`/api/nutrition/${id}`, {
      method: 'PATCH',
      body: { items },
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.nutrition() }),
  })
}
