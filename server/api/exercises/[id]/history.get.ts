import { getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Get exercise history and personal record',
    description: 'Per-session heaviest set logged for this exercise by the caller, most recent first, plus the overall personal record.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: {
        description: 'History and personal record',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                personalRecord: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    weightKg: { type: 'number' },
                    reps: { type: 'number' },
                    date: { type: 'string', format: 'date-time' },
                  },
                },
                history: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      sessionId: { type: 'string' },
                      date: { type: 'string', format: 'date-time' },
                      topSetWeightKg: { type: 'number' },
                      topSetReps: { type: 'number' },
                      setsCount: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const id = getRouterParam(event, 'id')!

  const history = await new SessionRepository(useDb()).findExerciseHistory(ctx.userId, id)

  const personalRecord = history.reduce<typeof history[number] | null>((best, entry) => {
    if (!best) return entry
    if (entry.topSetWeightKg > best.topSetWeightKg) return entry
    if (entry.topSetWeightKg === best.topSetWeightKg && entry.topSetReps > best.topSetReps) return entry
    return best
  }, null)

  return {
    personalRecord: personalRecord
      ? { weightKg: personalRecord.topSetWeightKg, reps: personalRecord.topSetReps, date: personalRecord.date }
      : null,
    history,
  }
})
