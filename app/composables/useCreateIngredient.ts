import type { FetchError } from 'ofetch'
import type { CreateIngredientInput } from '~~/server/repositories/ingredient.repository'
import type { Ingredient } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useCreateIngredient = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<Ingredient, CreateIngredientInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<Ingredient>('/api/nutrition/ingredients', {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.ingredients() }),
  })
}
