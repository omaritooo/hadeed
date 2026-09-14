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
  isWarmup: boolean
}

export const useLogSet = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<SetLog, LogSetPayload, FetchError<{ statusMessage: string }>>({
    mutation: ({ sessionId, ...input }) => $api<SetLog>(`/api/sessions/${sessionId}/sets`, {
      method: 'POST',
      body: { ...input, id: crypto.randomUUID() },
    }),
    // A logged set changes this session's log, the workouts summary, and — since
    // volumeKgInRange sums all sessions this week (in-progress included) and a PR
    // can award XP/streak credit synchronously — home's weekly volume and XP bar too.
    onSuccess: (_result, { sessionId }) => Promise.allSettled([
      queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
      queryCache.invalidateQueries({ key: queryKeys.workouts() }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
    ]),
  })
}
