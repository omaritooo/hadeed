import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { HydrationRepository } from '~~/server/repositories/hydration.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { HydrationService } from '~~/server/services/hydration.service'

defineRouteMeta({
  openAPI: {
    summary: 'Log a water intake entry',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['amountMl'],
            properties: {
              amountMl: { type: 'number' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The logged entry' },
      400: { description: 'amountMl must be a positive number' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { amountMl: number }
  const db = useDb()
  const service = new HydrationService(ctx, new HydrationRepository(db), new ProfileRepository(db))
  return service.logIntake(body.amountMl)
})
