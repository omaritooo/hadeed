import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Delete a mistakenly logged set',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Session id (unused; setId is looked up directly)' },
      { name: 'setId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: { description: 'The set log was deleted' },
      403: { description: 'Set log is not owned by the caller' },
      404: { description: 'Set log not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const setId = getRouterParam(event, 'setId')!
  const repo = new SessionRepository(useDb())

  const ownerId = await repo.findSetLogOwnerId(setId)
  if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Set log not found' })
  if (ownerId !== ctx.userId) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

  await repo.deleteSetLog(setId)
  return { success: true }
})
