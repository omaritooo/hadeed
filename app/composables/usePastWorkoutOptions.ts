import type { FetchError } from 'ofetch'
import type { PastWorkoutOptions } from '~~/shared/types/workouts.types'
import { useQuery } from '@pinia/colada'

export const usePastWorkoutOptions = () => {
  const { $api } = useNuxtApp()

  return useQuery<PastWorkoutOptions, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.pastWorkoutOptions(),
    query: () => $api<PastWorkoutOptions>('/api/workouts/past-options'),
  })
}
