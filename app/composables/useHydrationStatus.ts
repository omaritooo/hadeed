import type { FetchError } from 'ofetch'
import type { HydrationToday } from '~~/shared/types/hydration.types'
import { useQuery } from '@pinia/colada'

export const useHydrationStatus = () => {
  const { $api } = useNuxtApp()

  return useQuery<HydrationToday, FetchError<{ statusMessage: string }>>({
    key: () => ['hydration'],
    query: () => $api<HydrationToday>('/api/hydration'),
  })
}
