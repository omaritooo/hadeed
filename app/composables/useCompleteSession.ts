import { useMutation } from '@pinia/colada'

export const useCompleteSession = () => {
  const outbox = useOutbox()

  // Queued like every other write, behind this session's still-unsent sets -- the queue is
  // serial per session, so a workout can never complete without the last set it was waiting on.
  // The summary is a server computation, so it arrives later through `$outbox.serverSummaries`
  // rather than as this mutation's result.
  return useMutation<{ queued: true }, { sessionId: string, expectedVersion: number }>({
    mutation: async ({ sessionId, expectedVersion }) => {
      // completedAt is stamped now, not when the op drains, so a workout finished in a basement
      // records its real duration. The server clamps it to the session window.
      // Rejects if the store refuses the op -- see useLogSet for why that is surfaced.
      await outbox.add({ kind: 'complete_session', sessionId, payload: { expectedVersion, completedAt: new Date().toISOString() } })
      return { queued: true as const }
    },
  })
}
