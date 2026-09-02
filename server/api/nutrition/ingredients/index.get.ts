import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'

defineRouteMeta({
  openAPI: {
    summary: 'List your ingredient catalog',
    responses: {
      200: { description: 'Ingredients, alphabetically' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  return new IngredientRepository(useDb()).findAllForUser(ctx.userId)
})
