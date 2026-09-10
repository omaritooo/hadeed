import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { NutritionToday } from '~~/shared/types/nutrition.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

// `date` (YYYY-MM-DD) mirrors the endpoint's own optional query param (server defaults to
// today when omitted) -- powers the Today tab's day-navigation (Task 25). Leaving it
// undefined, or omitting the argument entirely, keeps today's behavior unchanged.
export const useNutritionToday = (date?: MaybeRefOrGetter<string | undefined>) => {
  const { $api } = useNuxtApp()

  return useQuery<NutritionToday, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.nutrition(toValue(date)),
    query: () => $api<NutritionToday>('/api/nutrition', {
      query: toValue(date) ? { date: toValue(date) } : undefined,
    }),
  })
}
