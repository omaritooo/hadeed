import type { FetchError } from 'ofetch'
import type { CreatePresetMealInput } from '~~/server/repositories/preset-meal.repository'
import type { PresetMeal } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useCreatePresetMeal = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<PresetMeal, CreatePresetMealInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<PresetMeal>('/api/nutrition/presets', {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.presetMeals() }),
  })
}
