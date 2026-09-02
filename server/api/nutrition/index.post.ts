import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Log an ad-hoc meal',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['items'],
            properties: {
              name: { type: 'string', nullable: true },
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
      200: { description: 'The logged meal, with computed per-item macros' },
      400: { description: 'No items, a non-positive quantity, or an unknown ingredientId' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { name?: string | null, items: { ingredientId: number, quantity: number }[] }
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.logMeal(body.name ?? null, body.items)
})
