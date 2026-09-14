import type { FetchError } from 'ofetch'
import type { TdeeEstimateResponse } from '~~/shared/types/nutrition.types'
import { useQuery } from '@pinia/colada'

export const useTdeeEstimate = () => {
  const { $api } = useNuxtApp()

  return useQuery<TdeeEstimateResponse, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.tdeeEstimate(),
    query: () => $api<TdeeEstimateResponse>('/api/nutrition/tdee-estimate'),
    // A 28-day window barely moves within a session.
    staleTime: 10 * 60_000,
  })
}
