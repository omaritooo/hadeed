import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  // NOTE: ownership is intentionally not checked on this route. logSet takes only an
  // exerciseLogId, not a sessionId, so verifying ownership here would require an extra
  // lookup (exercise_log -> session -> session.userId) on every single set logged — the
  // highest-frequency write in this feature. This is a real, known gap: a caller who
  // knows another user's exerciseLogId UUID could currently log a set into that user's
  // session. IDs are non-guessable UUIDs, which mitigates it, but this should be closed
  // before this goes further than local development. Deliberately out of scope here.
  await getRequestContext(event)
  const body = await readBody(event)
  const repo = new SessionRepository(useDb())
  return repo.logSet(body)
})
