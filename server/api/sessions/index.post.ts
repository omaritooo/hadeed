import { readBody } from 'h3'
import { useSessionService } from '~~/server/utils/session-service'

defineRouteMeta({
  openAPI: {
    summary: 'Start a workout session',
    description: 'Expires any stale in-progress sessions for the user, then starts a new one, snapshotting a progression suggestion per exercise.',
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
              format: { type: 'string', enum: ['straight_sets', 'circuit'] },
              rounds: { type: 'number' },
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
                    targetRepsMin: { type: 'number', nullable: true },
                    targetRepsMax: { type: 'number', nullable: true },
                    targetReps: { type: 'number', nullable: true, deprecated: true, description: 'Accepted for older app builds only. Used as both targetRepsMin and targetRepsMax when those are absent.' },
                    targetRpe: { type: 'number', nullable: true },
                    restSeconds: { type: 'number', nullable: true },
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
  const body = await readBody(event)
  const service = await useSessionService(event)

  return service.startSession(body)
})
