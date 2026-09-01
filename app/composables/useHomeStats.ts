import type { FetchError } from 'ofetch'
import type { HomeSummary } from '~~/shared/types/home.types'
import { useQuery } from '@pinia/colada'

export const useHomeStats = () => {
  const { $api } = useNuxtApp()

  return useQuery<HomeSummary, FetchError<{ statusMessage: string }>>({
    key: () => ['home'],
    query: () => $api<HomeSummary>('/api/home'),
  })
}
