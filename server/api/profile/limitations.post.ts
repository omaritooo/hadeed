import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { TargetRepository } from '~~/server/repositories/target.repository'
import { UserLimitationRepository } from '~~/server/repositories/user-limitation.repository'
import { ProfileService } from '~~/server/services/profile.service'
import { JOINT_AREAS } from '~~/shared/lib/joint-areas'

interface LimitationsRequestBody {
  limitations?: unknown
}

defineRouteMeta({
  openAPI: {
    summary: 'Replace the current user\'s joint limitations',
    description: 'Replaces the whole set of joint areas the user wants to go easy on. An empty or missing list clears them. Duplicates are collapsed and the result comes back in canonical order.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              limitations: { type: 'array', items: { type: 'string', enum: [...JOINT_AREAS] } },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The stored limitations, in canonical order' },
      400: { description: 'limitations is not a list, or contains an unknown area' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = (await readBody(event) ?? {}) as LimitationsRequestBody
  const areas = body.limitations ?? []

  if (!Array.isArray(areas)) {
    throw createError({ statusCode: 400, statusMessage: 'limitations must be a list of: ' + JOINT_AREAS.join(', ') })
  }

  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db), new TargetRepository(db), new UserLimitationRepository(db))
  return { limitations: await service.setLimitations(areas) }
})
