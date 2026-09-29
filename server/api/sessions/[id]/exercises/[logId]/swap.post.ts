import { createError, getRouterParam, readBody } from 'h3'
import { useSessionService } from '~~/server/utils/session-service'

defineRouteMeta({
  openAPI: {
    summary: 'Swap an exercise to its planned alternative',
    description: 'Exchanges the exercise log\'s exercise with its alternative and recomputes the progression suggestion. Only allowed before any set is logged on it. Replaying a swap that already landed returns the log unchanged.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'logId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['toExerciseId'],
            properties: {
              toExerciseId: { type: 'string', description: "The exercise to switch to: the log's current alternative." },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The swapped exercise log' },
      403: { description: 'Session is not owned by the caller' },
      404: { description: 'Session or exercise log not found' },
      409: { description: 'A set is already logged, the session has ended, or toExerciseId is not the alternative' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const logId = getRouterParam(event, 'logId')!
  const body = await readBody(event) as { toExerciseId?: unknown }
  if (typeof body?.toExerciseId !== 'string') throw createError({ statusCode: 400, statusMessage: 'toExerciseId is required' })

  const service = await useSessionService(event)
  return service.swapExercise(id, logId, body.toExerciseId)
})
