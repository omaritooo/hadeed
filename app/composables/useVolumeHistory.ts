import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { WeeklyVolumeSnapshot } from '~~/shared/types/workouts.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

// Wraps GET /api/stats/volume-history (Task 20) -- one WeeklyVolumeSnapshot per trailing
// week, oldest first, powering the Stats tab's per-muscle volume trend. `weeks` mirrors the
// endpoint's own optional query param (server clamps to 1-12, defaults to 8) -- omit it, or
// leave it undefined, to get the server default.
export const useVolumeHistory = (weeks?: MaybeRefOrGetter<number | undefined>) => {
  const { $api } = useNuxtApp()

  return useQuery<WeeklyVolumeSnapshot[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.volumeHistory(toValue(weeks)),
    query: () => $api<WeeklyVolumeSnapshot[]>('/api/stats/volume-history', {
      query: toValue(weeks) !== undefined ? { weeks: toValue(weeks) } : undefined,
    }),
  })
}
