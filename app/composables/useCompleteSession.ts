import type { FetchError } from 'ofetch'
import type { WorkoutSession } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useCompleteSession = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<WorkoutSession, { sessionId: string, expectedVersion: number }, FetchError<{ statusMessage: string }>>({
    mutation: ({ sessionId, expectedVersion }) => $api<WorkoutSession>(`/api/sessions/${sessionId}/complete`, {
      method: 'POST',
      body: { expectedVersion },
    }),
    onSuccess: (_result, { sessionId }) => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
      queryCache.invalidateQueries({ key: queryKeys.workouts() }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
    ]),
  })
}
