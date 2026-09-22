import { useMutation } from '@pinia/colada'

export interface DeleteSetLogPayload {
  sessionId: string
  setLogId: string
}

export const useDeleteSetLog = () => {
  const outbox = useOutbox()

  return useMutation<{ success: boolean }, DeleteSetLogPayload>({
    mutation: async ({ sessionId, setLogId }) => {
      // Deleting a set whose insert is still queued cancels both (see `enqueue`), so this often
      // costs no request at all.
      // Rejects if the store refuses the op -- see useLogSet for why that is surfaced.
      await outbox.add({ kind: 'delete_set', sessionId, payload: { setLogId } })
      return { success: true }
    },
  })
}
