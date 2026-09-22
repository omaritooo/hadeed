import type { SetLog } from '~~/shared/types/session.types'
import { useMutation } from '@pinia/colada'

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
  // Resolved in setup, where the Nuxt context exists. `$outbox` is undefined during SSR, but a
  // mutation only ever fires from a client event handler, so (unlike useSession) nothing here
  // dereferences it on the server.
  const outbox = useOutbox()

  return useMutation<SetLog, LogSetPayload>({
    mutation: async ({ sessionId, ...input }) => {
      // The id and the timestamp are fixed here, before the op is queued, so every replay of that
      // op inserts the same row -- and records when the set was actually performed rather than
      // when the queue happened to drain. Generating either per request (as this composable used
      // to, inside the fetch call) turns a retried send into a duplicate set.
      const payload = { ...input, id: crypto.randomUUID(), loggedAt: new Date().toISOString() }
      // `add` rejects only when IndexedDB refuses the op, and that is surfaced rather than
      // swallowed even though the op is already in memory and already on screen. The tempting
      // argument -- "it will sync anyway, so don't alarm the lifter" -- does not survive the
      // runner: a store whose reads work but whose writes fail (a quota wall) loses the op on
      // the very next flush, because a pass begins by reloading the queue from disk over the
      // in-memory one. A set that silently disappears is the one outcome this whole feature
      // exists to prevent, so the lifter is told and can log it again.
      await outbox.add({ kind: 'log_set', sessionId, payload })
      // The set the page needs is the one just queued; version 1 is what the server assigns a
      // fresh row, and applyPending renders the same shape until the real row comes back.
      return { ...payload, version: 1 }
    },
    // No invalidation here: nothing has been sent yet. The outbox plugin invalidates this
    // session's queries (plus workouts and home) once its queue drains.
  })
}
