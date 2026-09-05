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
    // Completion updates this session's status, drops it from the workouts summary's active
    // banner, and — via streak/XP awarded on completion — home's streak and XP bar.
    onSuccess: (_result, { sessionId }) => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
      queryCache.invalidateQueries({ key: queryKeys.workouts() }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
    ]),
  })
}
