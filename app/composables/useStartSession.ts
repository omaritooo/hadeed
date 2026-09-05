import type { FetchError } from 'ofetch'
import type { StartSessionInput } from '~~/server/repositories/session.repository'
import type { WorkoutSession } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useStartSession = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<WorkoutSession, Omit<StartSessionInput, 'id'>, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<WorkoutSession>('/api/sessions', {
      method: 'POST',
      body: { ...input, id: crypto.randomUUID() },
    }),
    // A new in-progress session must show up in the workouts summary's active-session banner.
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.workouts() }),
  })
}
