import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository, type AddFreeformExerciseInput } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as AddFreeformExerciseInput
  const repo = new SessionRepository(useDb())

  // Unlike sets.post.ts/sets/[setId].patch.ts, ownership is cheap to check here: the
  // request body already carries sessionId, so this is just findSessionById + a userId
  // comparison — no extra join/lookup chain, unlike the per-set-log routes where the
  // relevant id is a set/exercise log rather than the session itself.
  const session = await repo.findSessionById(body.sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  if (session.userId !== ctx.userId) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

  return repo.addFreeformExercise(body)
})
