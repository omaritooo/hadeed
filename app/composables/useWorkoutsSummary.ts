import type { FetchError } from 'ofetch'
import type { WorkoutsSummary } from '~~/shared/types/workouts.types'
import { useQuery } from '@pinia/colada'

export const useWorkoutsSummary = () => {
  const { $api } = useNuxtApp()

  return useQuery<WorkoutsSummary, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.workouts(),
    query: () => $api<WorkoutsSummary>('/api/workouts'),
  })
}
