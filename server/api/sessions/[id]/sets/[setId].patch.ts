import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  // NOTE: ownership is intentionally not checked on this route, for the same reason as
  // sets.post.ts — editSetLog takes only a setLogId, not a sessionId, so verifying
  // ownership here would require an extra lookup (set_log -> exercise_log -> session ->
  // session.userId) on every edit. A caller who knows another user's setLogId UUID could
  // currently edit a set on that user's session — AND, since this route echoes back
  // `result.setLog` (the full updated row) on success, that same caller can use this
  // endpoint to *read back* another user's real set data (weightKg/reps/rpe/loggedAt)
  // they never supplied, simply by PATCHing with a no-op/guessed correction and the
  // correct `expectedVersion` (a small, guessable integer, unlike the setLogId). That
  // makes this a genuine cross-user disclosure risk, not just a tampering risk — a
  // strictly worse gap than the write-only one on sets.post.ts. IDs are non-guessable
  // UUIDs, which mitigates it, but this is a real, known gap that should be closed
  // before this goes further than local development. Deliberately out of scope here;
  // closing it changes the perf characteristics of a hot write path and needs an
  // explicit call from the project owner, not a unilateral fix.
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
