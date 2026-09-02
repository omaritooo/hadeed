import { createError } from 'h3'
import { BaseService } from '~~/server/services/base.service'
import type { CreateIngredientInput, IngredientRepository, UpdateIngredientInput } from '~~/server/repositories/ingredient.repository'
import type { MealLogItemInput, MealLogRepository } from '~~/server/repositories/meal-log.repository'
import type { CreatePresetMealInput, PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { Ingredient, MealLog, NutritionToday, PresetMeal } from '~~/shared/types/nutrition.types'
import type { MacroTarget } from '~~/shared/types/split.types'
import { toSqliteDatetime } from '~~/server/utils/date'

const todayRange = (): { start: string, end: string } => {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 1)
  return { start: toSqliteDatetime(start), end: toSqliteDatetime(end) }
}

const scaleFor = (ingredient: Ingredient, quantity: number): number =>
  ingredient.unitType === 'weight_100g' ? quantity / 100 : quantity

const requireNonNegative = (values: (number | undefined)[], message: string): void => {
  for (const value of values) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw createError({ statusCode: 400, statusMessage: message })
    }
  }
}

export class NutritionService extends BaseService {
  constructor(
    ctx: RequestContext,
    private ingredients: IngredientRepository,
    private mealLogs: MealLogRepository,
    private presetMeals: PresetMealRepository,
    private profiles: ProfileRepository,
  ) {
    super(ctx)
  }

  listIngredients(): Promise<Ingredient[]> {
    return this.ingredients.findAllForUser(this.ctx.userId)
  }

  async createIngredient(input: CreateIngredientInput): Promise<Ingredient> {
    requireNonNegative([input.calories, input.proteinG, input.carbsG, input.fatG], 'Macro values must be non-negative numbers')
    return this.ingredients.create(this.ctx.userId, input)
  }

  async updateIngredient(id: number, input: UpdateIngredientInput): Promise<Ingredient> {
    requireNonNegative([input.calories, input.proteinG, input.carbsG, input.fatG], 'Macro values must be non-negative numbers')
    const updated = await this.ingredients.update(id, this.ctx.userId, input)
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Ingredient not found' })
    return updated
  }

  deleteIngredient(id: number): Promise<void> {
    return this.ingredients.delete(id, this.ctx.userId)
  }

  private async resolveItems(items: { ingredientId: number, quantity: number }[]): Promise<MealLogItemInput[]> {
    if (!items.length) throw createError({ statusCode: 400, statusMessage: 'A meal needs at least one item' })
    return Promise.all(items.map(async (item) => {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'quantity must be a positive number' })
      }
      const ingredient = await this.ingredients.findById(item.ingredientId, this.ctx.userId)
      if (!ingredient) throw createError({ statusCode: 400, statusMessage: `Unknown ingredient ${item.ingredientId}` })
      const scale = scaleFor(ingredient, item.quantity)
      return {
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        quantity: item.quantity,
        calories: ingredient.calories * scale,
        proteinG: ingredient.proteinG * scale,
        carbsG: ingredient.carbsG * scale,
        fatG: ingredient.fatG * scale,
      }
    }))
  }

  async logMeal(name: string | null, items: { ingredientId: number, quantity: number }[]): Promise<MealLog> {
    const resolved = await this.resolveItems(items)
    return this.mealLogs.log(this.ctx.userId, name, resolved)
  }

  async logPresetMeal(presetMealId: number): Promise<MealLog> {
    const preset = await this.presetMeals.findById(presetMealId, this.ctx.userId)
    if (!preset) throw createError({ statusCode: 404, statusMessage: 'Preset meal not found' })
    const resolved = await this.resolveItems(preset.items.map(item => ({ ingredientId: item.ingredientId, quantity: item.quantity })))
    return this.mealLogs.log(this.ctx.userId, preset.name, resolved)
  }

  deleteMealLog(id: number): Promise<void> {
    return this.mealLogs.delete(id, this.ctx.userId)
  }

  listPresetMeals(): Promise<PresetMeal[]> {
    return this.presetMeals.findAllForUser(this.ctx.userId)
  }

  async createPresetMeal(input: CreatePresetMealInput): Promise<PresetMeal> {
    if (!input.items.length) throw createError({ statusCode: 400, statusMessage: 'A preset meal needs at least one item' })
    return this.presetMeals.create(this.ctx.userId, input)
  }

  deletePresetMeal(id: number): Promise<void> {
    return this.presetMeals.delete(id, this.ctx.userId)
  }

  async setTarget(target: MacroTarget | null): Promise<void> {
    if (target) requireNonNegative([target.calories, target.proteinG, target.carbsG, target.fatG], 'Macro target values must be non-negative numbers')
    await this.profiles.setNutritionTarget(this.ctx.userId, target)
  }

  async getToday(): Promise<NutritionToday> {
    const { start, end } = todayRange()
    const [meals, profile] = await Promise.all([
      this.mealLogs.findForRange(this.ctx.userId, start, end),
      this.profiles.findByUserId(this.ctx.userId),
    ])

    const totals = meals.reduce((sum, meal) => {
      for (const item of meal.items) {
        sum.calories += item.calories
        sum.proteinG += item.proteinG
        sum.carbsG += item.carbsG
        sum.fatG += item.fatG
      }
      return sum
    }, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })

    const target = profile?.nutritionTarget ?? null
    // Signed, not clamped -- the user wants to know when they're over target, not just "0 to go".
    const remaining = target
      ? {
          calories: target.calories - totals.calories,
          proteinG: target.proteinG - totals.proteinG,
          carbsG: target.carbsG - totals.carbsG,
          fatG: target.fatG - totals.fatG,
        }
      : null

    return { totals, target, remaining, meals }
  }
}
