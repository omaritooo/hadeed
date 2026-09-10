import { describe, expect, it } from 'vitest'
import { suggestNutritionTarget } from '~~/shared/lib/nutrition-targets'

describe('suggestNutritionTarget', () => {
  it('applies a calorie deficit for fat_loss and splits macros ~30/40/30', () => {
    const result = suggestNutritionTarget({ tdee: 2000, goal: 'fat_loss' })

    expect(result.calories).toBeLessThan(2000)
    expect(result.calories).toBe(1650) // 2000 * (1 - 0.175)
    expect(result.proteinG).toBe(Math.round((result.calories * 0.3) / 4))
    expect(result.carbsG).toBe(Math.round((result.calories * 0.4) / 4))
    expect(result.fatG).toBe(Math.round((result.calories * 0.3) / 9))
  })

  it('applies a calorie surplus for muscle_gain and splits macros ~30/40/30', () => {
    const result = suggestNutritionTarget({ tdee: 2000, goal: 'muscle_gain' })

    expect(result.calories).toBeGreaterThan(2000)
    expect(result.calories).toBe(2250) // 2000 * (1 + 0.125)
    expect(result.proteinG).toBe(Math.round((result.calories * 0.3) / 4))
    expect(result.carbsG).toBe(Math.round((result.calories * 0.4) / 4))
    expect(result.fatG).toBe(Math.round((result.calories * 0.3) / 9))
  })

  it('uses TDEE as-is for maintenance with no adjustment', () => {
    const result = suggestNutritionTarget({ tdee: 2000, goal: 'maintenance' })

    expect(result.calories).toBe(2000)
    expect(result.proteinG).toBe(150)
    expect(result.carbsG).toBe(200)
    expect(result.fatG).toBe(67)
  })

  it('uses TDEE as-is for general_fitness and mobility', () => {
    expect(suggestNutritionTarget({ tdee: 2500, goal: 'general_fitness' }).calories).toBe(2500)
    expect(suggestNutritionTarget({ tdee: 2500, goal: 'mobility' }).calories).toBe(2500)
  })

  it('returns whole-number grams', () => {
    const result = suggestNutritionTarget({ tdee: 2137, goal: 'fat_loss' })

    expect(Number.isInteger(result.calories)).toBe(true)
    expect(Number.isInteger(result.proteinG)).toBe(true)
    expect(Number.isInteger(result.carbsG)).toBe(true)
    expect(Number.isInteger(result.fatG)).toBe(true)
  })
})
