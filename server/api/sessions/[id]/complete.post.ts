import { createError, getRouterParam, readBody } from 'h3'
import { useSessionService } from '~~/server/utils/session-service'
import { parseClientTimestamp } from '~~/server/utils/date'

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
              completedAt: { type: 'string', format: 'date-time', description: 'When the workout actually finished. Clamped to [session.started_at, now]; ignored if unparseable.' },
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
  const body = await readBody(event) as { expectedVersion: number, completedAt?: string }
  const service = await useSessionService(event)

  // A workout finished offline and synced later must record when the lifter stopped, not when the
  // outbox drained; an unreadable value falls back to the server clock.
  const result = await service.completeSession(id, body.expectedVersion, parseClientTimestamp(body.completedAt))
  if (result.conflict) {
    throw createError({ statusCode: 409, statusMessage: 'Session was modified elsewhere; check sync conflicts' })
  }
  return { session: result.session, summary: result.summary }
})
