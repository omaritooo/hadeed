import type { FetchError } from 'ofetch'
import type { PastSessionInput, PastSessionResult } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useLogPastSession = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<PastSessionResult, PastSessionInput, FetchError<{ statusMessage: string }>>({
    // The caller generates input.id once per form, so a retried save is the same session.
    mutation: input => $api<PastSessionResult>('/api/sessions/past', { method: 'POST', body: input }),
    // A backdated session changes history, weekly volume, PRs, XP and the last-performed loads.
    onSuccess: () => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.workouts() }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
      queryCache.invalidateQueries({ key: queryKeys.weeklyVolume() }),
      queryCache.invalidateQueries({ key: queryKeys.achievements() }),
      queryCache.invalidateQueries({ key: queryKeys.pastWorkoutOptions() }),
      queryCache.invalidateQueries({ key: ['volume-history'] }),
      queryCache.invalidateQueries({ key: ['pr-history'] }),
      queryCache.invalidateQueries({ key: ['exercise-history'] }),
    ]),
  })
}
