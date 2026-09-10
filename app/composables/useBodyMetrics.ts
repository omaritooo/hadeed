import type { FetchError } from 'ofetch'
import type { BodyMetric } from '~~/shared/types/profile.types'
import { useQuery } from '@pinia/colada'

// Read side of the body-metrics stack (write side is useRecordBodyMetric.ts).
// GET /api/body-metrics takes no query params today (no date range/limit support --
// confirmed by reading server/api/body-metrics/index.get.ts and BodyMetricsRepository.findForUser),
// so this simply mirrors the full history the endpoint returns, most recent first.
export const useBodyMetrics = () => {
  const { $api } = useNuxtApp()

  return useQuery<BodyMetric[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.bodyMetrics(),
    query: () => $api<BodyMetric[]>('/api/body-metrics'),
  })
}
