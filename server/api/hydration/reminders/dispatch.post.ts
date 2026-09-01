import { createError, getHeader } from 'h3'
import { useDb } from '~~/server/utils/db'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { PushSubscriptionRepository } from '~~/server/repositories/push-subscription.repository'
import { HydrationReminderService } from '~~/server/services/hydration-reminder.service'

defineRouteMeta({
  openAPI: {
    summary: 'Dispatch due hydration reminder notifications',
    description: 'Meant to be called by an external scheduler on a fixed interval (this app has no cron of its own), authenticated with a shared secret rather than a user session.',
    parameters: [
      { name: 'Authorization', in: 'header', required: true, schema: { type: 'string' }, description: 'Bearer <CRON_SECRET>' },
    ],
    responses: {
      200: { description: 'Dispatch result: how many users were due and how many notifications sent' },
      401: { description: 'Missing or incorrect bearer token' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const provided = getHeader(event, 'authorization')
  if (!config.cronSecret || provided !== `Bearer ${config.cronSecret}`) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const db = useDb()
  const service = new HydrationReminderService(new ProfileRepository(db), new PushSubscriptionRepository(db))
  return service.dispatchDue()
})
