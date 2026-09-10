import { getQuery } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get a day\'s nutrition summary',
    description: 'Totals, target, signed remaining (can be negative when over target), and the logged meals '
      + 'for the given day. Defaults to today when `date` is omitted.',
    parameters: [
      {
        name: 'date',
        in: 'query',
        required: false,
        schema: { type: 'string', format: 'date' },
        description: 'The calendar day to summarize, as YYYY-MM-DD. Defaults to today (UTC).',
      },
    ],
    responses: {
      200: { description: 'Nutrition summary for the requested (or default: today\'s) day' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const query = getQuery(event)
  const date = typeof query.date === 'string' && query.date ? query.date : undefined

  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.getToday(date)
})
