import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { ProfileService } from '~~/server/services/profile.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db))
  return { profile: await service.getProfile(), stats: await service.getComputedStats() }
})
