import type { FetchError } from 'ofetch'
import type { RecordBodyMetricInput } from '~~/server/repositories/body-metrics.repository'
import type { BodyMetric } from '~~/shared/types/profile.types'
import { useMutation } from '@pinia/colada'

export const useRecordBodyMetric = () => {
  const { $api } = useNuxtApp()

  return useMutation<BodyMetric, RecordBodyMetricInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<BodyMetric>('/api/body-metrics', {
      method: 'POST',
      body: input,
    }),
  })
}
