import { useMutation } from '@pinia/colada'

export interface SwapExercisePayload {
  sessionId: string
  exerciseLogId: string
  toExerciseId: string
}

// Queued rather than sent, like every other write on the session page: a lifter finds the bench
// taken in exactly the kind of basement gym where there's no signal. applyPending shows the swap
// at once; the server's recomputed suggestion arrives with the refetch after it syncs.
export const useSwapExercise = () => {
  const outbox = useOutbox()

  return useMutation<void, SwapExercisePayload>({
    mutation: async ({ sessionId, ...payload }) => {
      await outbox.add({ kind: 'swap_exercise', sessionId, payload })
    },
  })
}
