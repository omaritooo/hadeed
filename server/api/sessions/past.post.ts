import { readBody } from 'h3'
import { useSessionService } from '~~/server/utils/session-service'
import type { PastSessionInput } from '~~/shared/types/session.types'

defineRouteMeta({
  openAPI: {
    summary: 'Log a past workout',
    description: 'Writes a completed session dated up to 14 days back in one transaction, then awards set/session XP and re-detects PRs on later sets. Idempotent on id.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'startedAt', 'exercises'],
            properties: {
              id: { type: 'string' },
              startedAt: { type: 'string', format: 'date-time' },
              splitDayId: { type: 'number', nullable: true },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'exerciseId', 'setType', 'sets'],
                  properties: {
                    id: { type: 'string' },
                    exerciseId: { type: 'string' },
                    splitExerciseId: { type: 'number', nullable: true },
                    setType: { type: 'string', enum: ['weight_reps', 'bodyweight_reps', 'time'] },
                    targetSets: { type: 'number', nullable: true },
                    targetRepsMin: { type: 'number', nullable: true },
                    targetRepsMax: { type: 'number', nullable: true },
                    targetRpe: { type: 'number', nullable: true },
                    sets: { type: 'number' },
                    reps: { type: 'number', nullable: true },
                    weightKg: { type: 'number', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The stored session id and any PRs it set' },
      403: { description: 'Split day or session id belongs to someone else' },
      422: { description: 'Date outside the 14-day window, or an incomplete exercise' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as PastSessionInput
  const service = await useSessionService(event)
  return service.logPastSession({ ...body, splitDayId: body.splitDayId ?? null })
})
