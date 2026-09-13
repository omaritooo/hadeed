import type { MacroTarget } from '~~/shared/types/split.types'
import type { TdeeEstimate } from '~~/shared/lib/adaptive-tdee'

export type IngredientUnitType = 'weight_100g' | 'count'

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface Ingredient {
  id: number
  userId: string | null
  name: string
  unitType: IngredientUnitType
  unitLabel: string | null
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface MealLogItem {
  id: number
  mealLogId: number
  ingredientId: number | null
  ingredientName: string
  quantity: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface MealLog {
  id: number
  userId: string
  name: string | null
  loggedAt: string
  // Null only for rows logged before meal_type existed -- new logs are always given a
  // value (explicit or inferred from time of day), never left uncategorized.
  mealType: MealType | null
  items: MealLogItem[]
}

export interface PresetMealItem {
  id: number
  presetMealId: number
  ingredientId: number
  quantity: number
}

export interface PresetMeal {
  id: number
  userId: string
  name: string
  items: PresetMealItem[]
}

export interface NutritionToday {
  totals: MacroTarget
  target: MacroTarget | null
  remaining: MacroTarget | null
  meals: MealLog[]
  // The calendar day (YYYY-MM-DD, UTC) these totals cover -- always present, whether the
  // caller asked for a specific day or let it default to today.
  date: string
}

export type TdeeEstimateResponse = TdeeEstimate & {
  suggestedTarget: MacroTarget | null
  shouldSuggest: boolean
}
