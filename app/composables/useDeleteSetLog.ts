import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface DeleteSetLogPayload {
  sessionId: string
  setLogId: string
}

export const useDeleteSetLog = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ success: boolean }, DeleteSetLogPayload, FetchError<{ statusMessage: string }>>({
    mutation: ({ sessionId, setLogId }) => $api<{ success: boolean }>(`/api/sessions/${sessionId}/sets/${setLogId}`, {
      method: 'DELETE',
    }),
    // A deleted set also affects volumeKgInRange's weekly sum on home.
    onSuccess: (_result, { sessionId }) => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
    ]),
  })
}
