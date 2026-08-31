import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Start a workout session',
    description: 'Expires any stale in-progress sessions for the user, then starts a new one.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'exercises'],
            properties: {
              id: { type: 'string' },
              splitDayId: { type: 'number', nullable: true },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'exerciseId', 'position', 'setType'],
                  properties: {
                    id: { type: 'string' },
                    exerciseId: { type: 'string' },
                    splitExerciseId: { type: 'number', nullable: true },
                    position: { type: 'number' },
                    setType: { type: 'string', enum: ['weight_reps', 'bodyweight_reps', 'time'] },
                    targetSets: { type: 'number', nullable: true },
                    targetReps: { type: 'number', nullable: true },
                    targetRpe: { type: 'number', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The started session' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const repo = new SessionRepository(useDb())
  await repo.expireStaleSessions(ctx.userId)
  return repo.startSession(ctx.userId, body)
})
