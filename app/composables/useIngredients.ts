import type { FetchError } from 'ofetch'
import type { Ingredient } from '~~/shared/types/nutrition.types'
import { useQuery } from '@pinia/colada'

export const useIngredients = () => {
  const { $api } = useNuxtApp()

  return useQuery<Ingredient[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.ingredients(),
    query: () => $api<Ingredient[]>('/api/nutrition/ingredients'),
  })
}
