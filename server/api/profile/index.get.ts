import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { TargetRepository } from '~~/server/repositories/target.repository'
import { ProfileService } from '~~/server/services/profile.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db), new TargetRepository(db))
  return { profile: await service.getProfile(), stats: await service.getComputedStats() }
})
