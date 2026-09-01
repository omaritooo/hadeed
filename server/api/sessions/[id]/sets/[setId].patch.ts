import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Correct a logged set',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Session id (unused; setId is looked up directly)' },
      { name: 'setId', in: 'path', required: true, schema: { type: 'string' } },
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
              weightKg: { type: 'number', nullable: true },
              reps: { type: 'number', nullable: true },
              rpe: { type: 'number', nullable: true },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The updated set log' },
      403: { description: 'Set log is not owned by the caller' },
      404: { description: 'Set log not found' },
      409: { description: 'Set was modified elsewhere; check sync conflicts' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const setId = getRouterParam(event, 'setId')!
  const body = await readBody(event) as { expectedVersion: number, weightKg?: number | null, reps?: number | null, rpe?: number | null }
  const repo = new SessionRepository(useDb())

  const ownerId = await repo.findSetLogOwnerId(setId)
  if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Set log not found' })
  if (ownerId !== ctx.userId) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

  const corrections: { weightKg?: number | null, reps?: number | null, rpe?: number | null } = {}
  if ('weightKg' in body) corrections.weightKg = body.weightKg
  if ('reps' in body) corrections.reps = body.reps
  if ('rpe' in body) corrections.rpe = body.rpe

  const result = await repo.editSetLog(setId, body.expectedVersion, corrections)
  if (result.conflict) {
    throw createError({ statusCode: 409, statusMessage: 'Set was modified elsewhere; check sync conflicts' })
  }
  return result.setLog
})
