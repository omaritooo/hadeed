import type { FetchError } from 'ofetch'
import type { PresetMeal } from '~~/shared/types/nutrition.types'
import { useQuery } from '@pinia/colada'

export const usePresetMeals = () => {
  const { $api } = useNuxtApp()

  return useQuery<PresetMeal[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.presetMeals(),
    query: () => $api<PresetMeal[]>('/api/nutrition/presets'),
  })
}
