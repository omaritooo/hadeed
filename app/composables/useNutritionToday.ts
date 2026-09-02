import type { FetchError } from 'ofetch'
import type { NutritionToday } from '~~/shared/types/nutrition.types'
import { useQuery } from '@pinia/colada'

export const useNutritionToday = () => {
  const { $api } = useNuxtApp()

  return useQuery<NutritionToday, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.nutrition(),
    query: () => $api<NutritionToday>('/api/nutrition'),
  })
}
