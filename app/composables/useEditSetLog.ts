import type { FetchError } from 'ofetch'
import type { SetLog } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface EditSetLogPayload {
  sessionId: string
  setLogId: string
  expectedVersion: number
  weightKg?: number | null
  reps?: number | null
  rpe?: number | null
  isWarmup?: boolean
}

export const useEditSetLog = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<SetLog, EditSetLogPayload, FetchError<{ statusMessage: string }>>({
    mutation: ({ sessionId, setLogId, ...body }) => $api<SetLog>(`/api/sessions/${sessionId}/sets/${setLogId}`, {
      method: 'PATCH',
      body,
    }),
    // Corrected weight/reps also feed volumeKgInRange's weekly sum on home, even though
    // (unlike useLogSet) an edit never re-triggers PR/XP gamification.
    onSuccess: (_result, { sessionId }) => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
    ]),
  })
}
