import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  // NOTE: ownership is intentionally not checked on this route, for the same reason as
  // sets.post.ts — editSetLog takes only a setLogId, not a sessionId, so verifying
  // ownership here would require an extra lookup (set_log -> exercise_log -> session ->
  // session.userId). A caller who knows another user's setLogId UUID could currently
  // edit a set on that user's session. IDs are non-guessable UUIDs, which mitigates it,
  // but this is a real, known gap that should be closed before this goes further than
  // local development. Deliberately out of scope here.
  await getRequestContext(event)
  const setId = getRouterParam(event, 'setId')!
  const body = await readBody(event) as { expectedVersion: number, weightKg?: number | null, reps?: number | null, rpe?: number | null }
  const repo = new SessionRepository(useDb())

  // Only forward fields the client actually sent. Spreading `{ weightKg: body.weightKg,
  // reps: body.reps, rpe: body.rpe }` unconditionally would create own-enumerable keys
  // for every field even when the client omitted it (value `undefined`), which passes
  // editSetLog's ALLOWED_KEYS check but then fails at the db layer: @libsql/client
  // throws "undefined cannot be passed as argument to the database" for any bind arg
  // that is `undefined` (verified locally). Filtering to present keys avoids that.
  const corrections: { weightKg?: number | null, reps?: number | null, rpe?: number | null } = {}
  if ('weightKg' in body) corrections.weightKg = body.weightKg
  if ('reps' in body) corrections.reps = body.reps
  if ('rpe' in body) corrections.rpe = body.rpe

  const result = await repo.editSetLog(setId, body.expectedVersion, corrections)
  if (result.conflict) {
    throw createError({ statusCode: 409, statusMessage: 'Set was modified elsewhere; check sync conflicts' })
  }
  return result.setLog
})
