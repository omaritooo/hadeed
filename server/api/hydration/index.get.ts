import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { HydrationRepository } from '~~/server/repositories/hydration.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { HydrationService } from '~~/server/services/hydration.service'

defineRouteMeta({
  openAPI: {
    summary: "Get today's hydration summary",
    description: 'Total ml logged today, the daily target (if set), how far off it, and the individual log entries.',
    responses: {
      200: { description: "Today's hydration summary" },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new HydrationService(ctx, new HydrationRepository(db), new ProfileRepository(db))
  return service.getToday()
})
