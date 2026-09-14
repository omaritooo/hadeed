import type { FetchError } from 'ofetch'
import type { JointArea } from '~~/shared/lib/joint-areas'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useSetLimitations = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ limitations: JointArea[] }, JointArea[], FetchError<{ statusMessage: string }>>({
    mutation: limitations => $api<{ limitations: JointArea[] }>('/api/profile/limitations', {
      method: 'POST',
      body: { limitations },
    }),
    // The profile drives every limitation badge, and preset recommendations rank around the
    // limitations. allSettled, because the POST already succeeded: a failed refetch must not
    // make mutateAsync reject. Alternatives/fallbacks key on `avoid`, so they need no invalidation.
    onSuccess: () => Promise.allSettled([
      queryCache.invalidateQueries({ key: queryKeys.profile() }),
      queryCache.invalidateQueries({ key: queryKeys.presetSplits() }),
    ]),
  })
}
