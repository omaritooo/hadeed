import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { HydrationRepository } from '~~/server/repositories/hydration.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { HydrationService } from '~~/server/services/hydration.service'

defineRouteMeta({
  openAPI: {
    summary: 'Set the daily hydration target',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['targetMl'],
            properties: {
              targetMl: { type: 'number', nullable: true, description: 'Pass null to clear the target' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Target updated' },
      400: { description: 'targetMl must be a positive number or null' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { targetMl: number | null }
  const db = useDb()
  const service = new HydrationService(ctx, new HydrationRepository(db), new ProfileRepository(db))
  await service.setTarget(body.targetMl)
  return { targetMl: body.targetMl }
})
