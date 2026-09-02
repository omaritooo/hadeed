import type { FetchError } from 'ofetch'
import type { CreateFromScratchInput } from '~~/server/services/split.service'
import type { Block } from '~~/shared/types/split.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useCreateBlock = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<Block, CreateFromScratchInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<Block>('/api/blocks', {
      method: 'POST',
      body: input,
    }),
    // A new active block changes home's todaysWorkout/activeSession/weeklyProgress.
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.home() }),
  })
}
