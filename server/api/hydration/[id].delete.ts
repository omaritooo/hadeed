import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { HydrationRepository } from '~~/server/repositories/hydration.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { HydrationService } from '~~/server/services/hydration.service'

defineRouteMeta({
  openAPI: {
    summary: 'Delete a hydration log entry',
    description: 'A mistaken id, or one belonging to another user, deletes nothing rather than erroring.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ],
    responses: {
      200: { description: 'Entry deleted (or already gone)' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })

  const db = useDb()
  const service = new HydrationService(ctx, new HydrationRepository(db), new ProfileRepository(db))
  await service.deleteEntry(id)
  return { success: true }
})
