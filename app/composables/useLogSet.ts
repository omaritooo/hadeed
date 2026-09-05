import type { FetchError } from 'ofetch'
import type { SetLog } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface LogSetPayload {
  sessionId: string
  exerciseLogId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rpe: number | null
}

export const useLogSet = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<SetLog, LogSetPayload, FetchError<{ statusMessage: string }>>({
    mutation: ({ sessionId, ...input }) => $api<SetLog>(`/api/sessions/${sessionId}/sets`, {
      method: 'POST',
      body: { ...input, id: crypto.randomUUID() },
    }),
    onSuccess: (_result, { sessionId }) => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
      queryCache.invalidateQueries({ key: queryKeys.workouts() }),
    ]),
  })
}
