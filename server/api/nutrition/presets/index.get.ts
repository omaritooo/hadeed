import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'

defineRouteMeta({
  openAPI: {
    summary: 'List your preset meals',
    responses: {
      200: { description: 'Preset meals, alphabetically, with items' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  return new PresetMealRepository(useDb()).findAllForUser(ctx.userId)
})
