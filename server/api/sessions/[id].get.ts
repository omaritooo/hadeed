import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Get a session with its exercises and sets',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: { description: 'The session with nested exercise logs and set logs' },
      403: { description: 'Session is not owned by the caller' },
      404: { description: 'Session not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const id = getRouterParam(event, 'id')!
  const repo = new SessionRepository(useDb())

  const session = await repo.findWithLogs(id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  if (session.userId !== ctx.userId) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

  return session
})
