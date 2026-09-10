import type { FetchError } from 'ofetch'
import type { AchievementWithProgress } from '~~/shared/types/gamification.types'
import { useQuery } from '@pinia/colada'

export const useAchievements = () => {
  const { $api } = useNuxtApp()

  return useQuery<AchievementWithProgress[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.achievements(),
    query: () => $api<AchievementWithProgress[]>('/api/achievements'),
  })
}
