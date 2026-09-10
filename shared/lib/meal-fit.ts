import type { MacroTarget } from '~~/shared/types/split.types'

export interface MacroFit {
  /** Already eaten on the day being viewed. */
  consumed: number
  /** What the draft meal would add. */
  meal: number
  /** consumed + meal. */
  projected: number
  target: number
  /** 0 when the meal fits; otherwise how far past target it lands. */
  overBy: number
  fits: boolean
}

export type MealFit = Record<keyof MacroTarget, MacroFit>

const MACRO_KEYS: (keyof MacroTarget)[] = ['calories', 'proteinG', 'carbsG', 'fatG']

/**
 * Weighs a draft meal against what's left of the day's macro target, without logging it.
 *
 * Returns null when no target is set -- there's nothing to fit against, and the caller is
 * expected to fall back to showing the meal's raw macros rather than hiding them.
 */
export const evaluateMealFit = (input: {
  totals: MacroTarget
  meal: MacroTarget
  target: MacroTarget | null
}): MealFit | null => {
  const { totals, meal, target } = input
  if (!target) return null

  // Ingredient macros are scaled floats (quantity / 100), so every comparison rounds first.
  // Comparing the raw values would flag a projected 2000.4 against a 2000 target as an
  // overshoot, then render it as "over by 0" -- a warning for a rounding artifact.
  return Object.fromEntries(MACRO_KEYS.map((key) => {
    const consumed = Math.round(totals[key])
    const mealAmount = Math.round(meal[key])
    const projected = consumed + mealAmount
    const targetAmount = Math.round(target[key])
    const overBy = Math.max(0, projected - targetAmount)

    return [key, {
      consumed,
      meal: mealAmount,
      projected,
      target: targetAmount,
      overBy,
      fits: overBy === 0,
    } satisfies MacroFit]
  })) as MealFit
}
