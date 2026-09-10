import type { Goal } from '~~/shared/types/profile.types'
import type { MacroTarget } from '~~/shared/types/split.types'

// Standard TDEE adjustment per goal: a moderate deficit for fat loss, a lean surplus for
// muscle gain, and TDEE itself for goals with no cutting/bulking intent.
const CALORIE_ADJUSTMENT_BY_GOAL: Record<Goal, number> = {
  fat_loss: -0.175, // ~17.5% deficit (within the plan's suggested 15-20% range)
  muscle_gain: 0.125, // ~12.5% surplus (within the plan's suggested 10-15% range)
  maintenance: 0,
  general_fitness: 0,
  mobility: 0,
}

// A common default macro split by percentage of calories: 30% protein / 40% carbs / 30% fat.
const PROTEIN_PCT = 0.3
const CARBS_PCT = 0.4
const FAT_PCT = 0.3

export const suggestNutritionTarget = (input: { tdee: number, goal: Goal }): MacroTarget => {
  const adjustment = CALORIE_ADJUSTMENT_BY_GOAL[input.goal]
  const calories = Math.round(input.tdee * (1 + adjustment))

  return {
    calories,
    proteinG: Math.round((calories * PROTEIN_PCT) / 4),
    carbsG: Math.round((calories * CARBS_PCT) / 4),
    fatG: Math.round((calories * FAT_PCT) / 9),
  }
}
