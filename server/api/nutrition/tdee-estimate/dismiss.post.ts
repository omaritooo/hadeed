import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { TargetRepository } from '~~/server/repositories/target.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { UserLimitationRepository } from '~~/server/repositories/user-limitation.repository'
import { ProfileService } from '~~/server/services/profile.service'
import { TdeeEstimateService } from '~~/server/services/tdee-estimate.service'

defineRouteMeta({
  openAPI: {
    summary: 'Snooze the TDEE target suggestion for 14 days',
    responses: {
      200: { description: 'Suggestion snoozed' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const profiles = new ProfileRepository(db)
  const bodyMetrics = new BodyMetricsRepository(db)
  const profileService = new ProfileService(ctx, profiles, bodyMetrics, new UserRepository(db), new TargetRepository(db), new UserLimitationRepository(db))
  const service = new TdeeEstimateService(ctx, profiles, bodyMetrics, new MealLogRepository(db), profileService)
  await service.dismiss()
  return { success: true }
})
