import type { MealType } from '~~/shared/types/nutrition.types'

// Infers a reasonable meal category from the hour of day (0-23, local to whichever
// timezone the caller resolves) for meals logged without an explicit category. Boundaries:
// before 11am -> breakfast, 11am-3pm -> lunch, 3pm-9pm -> dinner, else -> snack.
export const inferMealType = (hour: number): MealType => {
  if (hour < 11) return 'breakfast'
  if (hour < 15) return 'lunch'
  if (hour < 21) return 'dinner'
  return 'snack'
}
