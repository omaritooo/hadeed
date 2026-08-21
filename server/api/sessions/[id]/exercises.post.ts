import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const body = await readBody(event)
  const repo = new SessionRepository(useDb())
  return repo.addFreeformExercise(body)
})
