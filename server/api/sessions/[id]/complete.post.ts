import { createError, getRouterParam, readBody } from 'h3'
import { useSessionService } from '~~/server/utils/session-service'

defineRouteMeta({
  openAPI: {
    summary: 'Complete a workout session',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['expectedVersion'],
            properties: {
              expectedVersion: { type: 'number' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The completed session and its post-workout summary (volume, duration, PRs, streak)' },
      409: { description: 'Session was modified elsewhere; check sync conflicts' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event) as { expectedVersion: number }
  const service = await useSessionService(event)

  const result = await service.completeSession(id, body.expectedVersion)
  if (result.conflict) {
    throw createError({ statusCode: 409, statusMessage: 'Session was modified elsewhere; check sync conflicts' })
  }
  return { session: result.session, summary: result.summary }
})
