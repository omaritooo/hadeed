import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { RecentPr } from '~~/shared/types/home.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

// Wraps GET /api/stats/pr-history (Task 20) -- every PR the caller has hit, most recent
// first, uncapped unless `limit` is given. Powers the Stats tab's PR timeline (unlike the
// home/workouts summaries' 5-item recentPrs, which reuse the same RecentPr shape).
export const usePrHistory = (limit?: MaybeRefOrGetter<number | undefined>) => {
  const { $api } = useNuxtApp()

  return useQuery<RecentPr[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.prHistory(toValue(limit)),
    query: () => $api<RecentPr[]>('/api/stats/pr-history', {
      query: toValue(limit) !== undefined ? { limit: toValue(limit) } : undefined,
    }),
  })
}
