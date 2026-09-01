import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PushSubscriptionRepository } from '~~/server/repositories/push-subscription.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Remove a push subscription',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['endpoint'],
            properties: { endpoint: { type: 'string' } },
          },
        },
      },
    },
    responses: {
      200: { description: 'Removed (or already gone)' },
    },
  },
})

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const body = await readBody(event) as { endpoint: string }
  const db = useDb()
  await new PushSubscriptionRepository(db).deleteByEndpoint(body.endpoint)
  return { success: true }
})
