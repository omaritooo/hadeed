import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  // NOTE: ownership is intentionally not checked on this route. logSet takes only an
  // exerciseLogId, not a sessionId, so verifying ownership here would require an extra
  // lookup (exercise_log -> session -> session.userId) on every single set logged — the
  // highest-frequency write in this feature. This is a real, known gap: a caller who
  // knows another user's exerciseLogId UUID could currently log a (write-only; this
  // route returns only the newly-created row, not any other user's existing data) set
  // into that user's session. IDs are non-guessable UUIDs, which mitigates it, but this
  // is a deliberate perf-vs-security tradeoff, not an oversight — closing it changes the
  // performance characteristics of this hot write path and needs an explicit call from
  // the project owner. Deliberately out of scope here.
  await getRequestContext(event)
  const body = await readBody(event) as {
    id: string
    exerciseLogId: string
    setNumber: number
    weightKg?: number | null
    reps?: number | null
    rpe?: number | null
  }
  const repo = new SessionRepository(useDb())

  // Normalize omitted fields to null before they reach the repository. A client logging
  // a bodyweight_reps or time set very plausibly omits weightKg/reps rather than sending
  // an explicit null, and LogSetInput's fields are all nullable — passing an omitted
  // (i.e. `undefined`) field straight through would throw at the db layer, since
  // @libsql/client rejects `undefined` bind args (see the same bug fixed in
  // sets/[setId].patch.ts).
  return repo.logSet({
    id: body.id,
    exerciseLogId: body.exerciseLogId,
    setNumber: body.setNumber,
    weightKg: body.weightKg ?? null,
    reps: body.reps ?? null,
    rpe: body.rpe ?? null,
  })
})
