import { useMutation } from '@pinia/colada'

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
  const outbox = useOutbox()

  // The queue answers before the server does, so there is no edited row to hand back -- the page
  // reads the correction off the pending overlay instead.
  return useMutation<{ success: boolean }, EditSetLogPayload>({
    mutation: async ({ sessionId, setLogId, expectedVersion, ...corrections }) => {
      // Rejects if the store refuses the op -- see useLogSet for why that is surfaced.
      await outbox.add({ kind: 'edit_set', sessionId, payload: { setLogId, expectedVersion, corrections } })
      return { success: true }
    },
    // A 409 can no longer surface here: the conflict is found when the op replays, and the runner
    // reports it through the outbox's notices.
  })
}
