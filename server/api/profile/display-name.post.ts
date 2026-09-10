import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { TargetRepository } from '~~/server/repositories/target.repository'
import { ProfileService } from '~~/server/services/profile.service'

defineRouteMeta({
  openAPI: {
    summary: 'Update the current user\'s display name',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['displayName'],
            properties: {
              displayName: { type: 'string' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Display name updated' },
      400: { description: 'displayName must be a non-empty string' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { displayName: unknown }
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  if (!displayName) {
    throw createError({ statusCode: 400, statusMessage: 'displayName must be a non-empty string' })
  }

  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db), new TargetRepository(db))
  await service.updateDisplayName(displayName)
  return { displayName }
})
