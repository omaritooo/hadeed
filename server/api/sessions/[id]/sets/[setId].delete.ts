import { getRouterParam } from 'h3'
import { useSessionService } from '~~/server/utils/session-service'

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
  const setId = getRouterParam(event, 'setId')!
  const service = await useSessionService(event)

  await service.deleteSet(setId)
  return { success: true }
})
