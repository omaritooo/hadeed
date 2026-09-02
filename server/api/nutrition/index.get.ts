import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get today\'s nutrition summary',
    description: 'Totals, target, signed remaining (can be negative when over target), and today\'s logged meals.',
    responses: {
      200: { description: 'Today\'s nutrition summary' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.getToday()
})
