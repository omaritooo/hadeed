import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository, type CreatePresetMealInput } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Save a preset meal',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'items'],
            properties: {
              name: { type: 'string' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['ingredientId', 'quantity'],
                  properties: {
                    ingredientId: { type: 'number' },
                    quantity: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The created preset meal' },
      400: { description: 'No items' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as CreatePresetMealInput
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.createPresetMeal(body)
})
