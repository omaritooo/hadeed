import { createError } from 'h3'
import { BaseService } from '~~/server/services/base.service'
import type { CreateIngredientInput, IngredientRepository, UpdateIngredientInput } from '~~/server/repositories/ingredient.repository'
import type { MealLogItemInput, MealLogRepository } from '~~/server/repositories/meal-log.repository'
import type { CreatePresetMealInput, PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { Ingredient, IngredientUnitType, MealLog, MealType, NutritionToday, PresetMeal } from '~~/shared/types/nutrition.types'
import type { MacroTarget } from '~~/shared/types/split.types'
import { toSqliteDatetime } from '~~/server/utils/date'
import { inferMealType } from '~~/shared/lib/meal-type'

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Defaults to today (UTC) when no date is given -- `date`, when provided, must be a plain
// YYYY-MM-DD string (as sent by the nutrition history UI's day-navigation), not a full
// datetime, since callers are always asking for one whole calendar day.
const dayRange = (date?: string): { start: string, end: string } => {
  if (date !== undefined && !DATE_ONLY_PATTERN.test(date)) {
    throw createError({ statusCode: 400, statusMessage: 'date must be in YYYY-MM-DD format' })
  }
  const start = date ? new Date(`${date}T00:00:00Z`) : new Date()
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

const requireUnitLabelForCount = (unitType: IngredientUnitType, unitLabel: string | null | undefined): void => {
  if (unitType === 'count' && (!unitLabel || !unitLabel.trim())) {
    throw createError({ statusCode: 400, statusMessage: 'unitLabel is required for count-type ingredients' })
  }
}

// Local wall-clock hour in the given IANA timezone (falls back to UTC when the user hasn't
// set one), used only to feed inferMealType -- kept separate from that pure function so the
// inference logic itself stays trivially testable without timezone plumbing.
const localHour = (timezone: string | null): number => {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone ?? 'UTC',
    hour: 'numeric',
    hour12: false,
  }).format(new Date())
  return Number(formatted) % 24
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
    requireUnitLabelForCount(input.unitType, input.unitLabel)
    return this.ingredients.create(this.ctx.userId, input)
  }

  async updateIngredient(id: number, input: UpdateIngredientInput): Promise<Ingredient> {
    requireNonNegative([input.calories, input.proteinG, input.carbsG, input.fatG], 'Macro values must be non-negative numbers')

    // Only re-check the count/unitLabel invariant when this update actually touches one of
    // those fields -- otherwise an unrelated patch (e.g. calories only) would need no lookup.
    if ('unitType' in input || 'unitLabel' in input) {
      const current = await this.ingredients.findById(id, this.ctx.userId)
      if (!current) throw createError({ statusCode: 404, statusMessage: 'Ingredient not found' })
      const resultingUnitType = input.unitType ?? current.unitType
      const resultingUnitLabel = 'unitLabel' in input ? input.unitLabel : current.unitLabel
      requireUnitLabelForCount(resultingUnitType, resultingUnitLabel)
    }

    const updated = await this.ingredients.update(id, this.ctx.userId, input)
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Ingredient not found' })
    return updated
  }

  deleteIngredient(id: number): Promise<void> {
    return this.ingredients.delete(id, this.ctx.userId)
  }

  private async assertIngredientOwned(ingredientId: number): Promise<Ingredient> {
    const ingredient = await this.ingredients.findById(ingredientId, this.ctx.userId)
    if (!ingredient) throw createError({ statusCode: 400, statusMessage: `Unknown ingredient ${ingredientId}` })
    return ingredient
  }

  private async resolveItems(items: { ingredientId: number, quantity: number }[]): Promise<MealLogItemInput[]> {
    if (!items.length) throw createError({ statusCode: 400, statusMessage: 'A meal needs at least one item' })
    return Promise.all(items.map(async (item) => {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'quantity must be a positive number' })
      }
      const ingredient = await this.assertIngredientOwned(item.ingredientId)
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

  // Falls back to a time-of-day guess (breakfast/lunch/dinner/snack) whenever the caller
  // doesn't pick one explicitly, rather than forcing a manual selection on every log.
  private async resolveMealType(mealType: MealType | undefined): Promise<MealType> {
    if (mealType) return mealType
    const profile = await this.profiles.findByUserId(this.ctx.userId)
    return inferMealType(localHour(profile?.timezone ?? null))
  }

  async logMeal(name: string | null, items: { ingredientId: number, quantity: number }[], mealType?: MealType): Promise<MealLog> {
    const resolved = await this.resolveItems(items)
    const resolvedMealType = await this.resolveMealType(mealType)
    return this.mealLogs.log(this.ctx.userId, name, resolved, resolvedMealType)
  }

  async logPresetMeal(presetMealId: number, mealType?: MealType): Promise<MealLog> {
    const preset = await this.presetMeals.findById(presetMealId, this.ctx.userId)
    if (!preset) throw createError({ statusCode: 404, statusMessage: 'Preset meal not found' })
    const resolved = await this.resolveItems(preset.items.map(item => ({ ingredientId: item.ingredientId, quantity: item.quantity })))
    const resolvedMealType = await this.resolveMealType(mealType)
    return this.mealLogs.log(this.ctx.userId, preset.name, resolved, resolvedMealType)
  }

  async editMealLog(id: number, items: { ingredientId: number, quantity: number }[]): Promise<MealLog> {
    const resolved = await this.resolveItems(items)
    const updated = await this.mealLogs.replaceItems(id, this.ctx.userId, resolved)
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Meal not found' })
    return updated
  }

  deleteMealLog(id: number): Promise<void> {
    return this.mealLogs.delete(id, this.ctx.userId)
  }

  listPresetMeals(): Promise<PresetMeal[]> {
    return this.presetMeals.findAllForUser(this.ctx.userId)
  }

  async createPresetMeal(input: CreatePresetMealInput): Promise<PresetMeal> {
    if (!input.items.length) throw createError({ statusCode: 400, statusMessage: 'A preset meal needs at least one item' })
    await Promise.all(input.items.map(item => this.assertIngredientOwned(item.ingredientId)))
    return this.presetMeals.create(this.ctx.userId, input)
  }

  deletePresetMeal(id: number): Promise<void> {
    return this.presetMeals.delete(id, this.ctx.userId)
  }

  async setTarget(target: MacroTarget | null): Promise<void> {
    if (target) requireNonNegative([target.calories, target.proteinG, target.carbsG, target.fatG], 'Macro target values must be non-negative numbers')
    await this.profiles.setNutritionTarget(this.ctx.userId, target)
  }

  async getToday(date?: string): Promise<NutritionToday> {
    const { start, end } = dayRange(date)
    // `start` is already a normalized "YYYY-MM-DD HH:MM:SS" -- slicing it gives back the
    // resolved calendar day even when `date` itself was omitted (defaulted to today).
    const resolvedDate = start.slice(0, 10)
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

    return { totals, target, remaining, meals, date: resolvedDate }
  }
}
