import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'

defineRouteMeta({
  openAPI: {
    summary: 'List body metrics history',
    description: 'All recorded body metrics for the authenticated user, most recent first.',
    responses: {
      200: { description: 'Body metrics history' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  return new BodyMetricsRepository(db).findForUser(ctx.userId)
})
