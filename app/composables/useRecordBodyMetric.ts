import type { FetchError } from 'ofetch'
import type { RecordBodyMetricInput } from '~~/server/repositories/body-metrics.repository'
import type { BodyMetric } from '~~/shared/types/profile.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useRecordBodyMetric = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<BodyMetric, RecordBodyMetricInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<BodyMetric>('/api/body-metrics', {
      method: 'POST',
      body: input,
    }),
    // A new weigh-in changes profile.stats (bmi/tdee/latestWeightKg) and home's weightTrend sparkline.
    onSuccess: () => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.profile() }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
    ]),
  })
}
