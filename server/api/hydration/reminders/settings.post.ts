import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Enable/disable hydration reminders and set the interval',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['enabled', 'intervalMinutes'],
            properties: {
              enabled: { type: 'boolean' },
              intervalMinutes: { type: 'number', minimum: 1 },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Settings updated' },
      400: { description: 'intervalMinutes must be a positive number' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { enabled: boolean, intervalMinutes: number }
  if (!Number.isFinite(body.intervalMinutes) || body.intervalMinutes <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'intervalMinutes must be a positive number' })
  }
  const db = useDb()
  await new ProfileRepository(db).setHydrationReminderSettings(ctx.userId, body.enabled, body.intervalMinutes)
  return { enabled: body.enabled, intervalMinutes: body.intervalMinutes }
})
