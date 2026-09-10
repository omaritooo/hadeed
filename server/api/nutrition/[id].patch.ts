import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Edit an already-logged meal\'s items',
    description: 'Replaces the meal\'s items wholesale (delete-then-reinsert) rather than diffing individual items.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['ingredientId', 'quantity'],
                  properties: {
                    ingredientId: { type: 'number' },
                    quantity: { type: 'number', description: 'Grams if the ingredient is weight_100g, count of unit_label if count' },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The updated meal, with recomputed per-item macros' },
      400: { description: 'No items, a non-positive quantity, or an unknown ingredientId' },
      404: { description: 'Meal not found, or not owned by this user' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })

  const body = await readBody(event) as { items: { ingredientId: number, quantity: number }[] }
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.editMealLog(id, body.items)
})
