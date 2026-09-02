import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'
import type { MacroTarget } from '~~/shared/types/split.types'

defineRouteMeta({
  openAPI: {
    summary: 'Set the daily macro target',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['target'],
            properties: {
              target: {
                type: 'object',
                nullable: true,
                description: 'Pass null to clear the target',
                properties: {
                  calories: { type: 'number' },
                  proteinG: { type: 'number' },
                  carbsG: { type: 'number' },
                  fatG: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Target updated' },
      400: { description: 'A macro value was negative' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { target: MacroTarget | null }
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  await service.setTarget(body.target)
  return { target: body.target }
})
