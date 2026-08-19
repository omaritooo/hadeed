import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { BodyMetricsService } from '~~/server/services/body-metrics.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const service = new BodyMetricsService(ctx, new BodyMetricsRepository(useDb()))
  return service.record(body)
})
