import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository, type CreateIngredientInput } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Add an ingredient to your catalog',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'unitType', 'calories', 'proteinG', 'carbsG', 'fatG'],
            properties: {
              name: { type: 'string' },
              unitType: { type: 'string', enum: ['weight_100g', 'count'] },
              unitLabel: { type: 'string', nullable: true, description: 'e.g. cup, can, scoop. Required when unitType is count.' },
              calories: { type: 'number' },
              proteinG: { type: 'number' },
              carbsG: { type: 'number' },
              fatG: { type: 'number' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The created ingredient' },
      400: { description: 'A macro value was negative' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as CreateIngredientInput
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.createIngredient(body)
})
