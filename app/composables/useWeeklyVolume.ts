import type { FetchError } from 'ofetch'
import type { MuscleVolume } from '~~/shared/types/workouts.types'
import { useQuery } from '@pinia/colada'

export const useWeeklyVolume = () => {
  const { $api } = useNuxtApp()

  return useQuery<MuscleVolume[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.weeklyVolume(),
    query: () => $api<MuscleVolume[]>('/api/workouts/weekly-volume'),
  })
}
