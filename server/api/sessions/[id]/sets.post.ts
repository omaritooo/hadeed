import { readBody } from 'h3'
import { useSessionService } from '~~/server/utils/session-service'

defineRouteMeta({
  openAPI: {
    summary: 'Log a set',
    description: 'Idempotent on (id, exerciseLogId): replaying the same pair returns the existing set log.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'exerciseLogId', 'setNumber'],
            properties: {
              id: { type: 'string' },
              exerciseLogId: { type: 'string' },
              setNumber: { type: 'number' },
              weightKg: { type: 'number', nullable: true },
              reps: { type: 'number', nullable: true },
              rpe: { type: 'number', nullable: true },
              isWarmup: { type: 'boolean' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The logged (or pre-existing) set' },
      403: { description: 'Exercise log is not owned by the caller' },
      404: { description: 'Exercise log not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as {
    id: string
    exerciseLogId: string
    setNumber: number
    weightKg?: number | null
    reps?: number | null
    rpe?: number | null
    isWarmup?: boolean
  }
  const service = await useSessionService(event)

  return service.logSet({
    id: body.id,
    exerciseLogId: body.exerciseLogId,
    setNumber: body.setNumber,
    weightKg: body.weightKg ?? null,
    reps: body.reps ?? null,
    rpe: body.rpe ?? null,
    isWarmup: body.isWarmup ?? false,
  })
})
