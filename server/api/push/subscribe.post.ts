import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PushSubscriptionRepository } from '~~/server/repositories/push-subscription.repository'
import type { PushSubscriptionInput } from '~~/shared/types/push.types'

defineRouteMeta({
  openAPI: {
    summary: 'Register a push subscription for this device',
    description: 'Body is the browser PushSubscription object as returned by pushManager.subscribe().toJSON().',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['endpoint', 'keys'],
            properties: {
              endpoint: { type: 'string' },
              keys: {
                type: 'object',
                required: ['p256dh', 'auth'],
                properties: {
                  p256dh: { type: 'string' },
                  auth: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The saved subscription' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as PushSubscriptionInput
  const db = useDb()
  return new PushSubscriptionRepository(db).save(ctx.userId, body)
})
