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
}

export const useEditSetLog = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<SetLog, EditSetLogPayload, FetchError<{ statusMessage: string }>>({
    mutation: ({ sessionId, setLogId, ...body }) => $api<SetLog>(`/api/sessions/${sessionId}/sets/${setLogId}`, {
      method: 'PATCH',
      body,
    }),
    onSuccess: (_result, { sessionId }) => queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
  })
}
