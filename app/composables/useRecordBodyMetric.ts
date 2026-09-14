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
    // A new weigh-in changes profile.stats (bmi/tdee/latestWeightKg), home's weightTrend
    // sparkline, and the recent-entries list rendered by useBodyMetrics.
    onSuccess: () => {
      queryCache.invalidateQueries({ key: queryKeys.tdeeEstimate() }).catch(() => {})
      return Promise.all([
        queryCache.invalidateQueries({ key: queryKeys.profile() }),
        queryCache.invalidateQueries({ key: queryKeys.home() }),
        queryCache.invalidateQueries({ key: queryKeys.bodyMetrics() }),
      ])
    },
  })
}
