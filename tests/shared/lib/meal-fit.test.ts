import { describe, expect, it } from 'vitest'
import { evaluateMealFit } from '~~/shared/lib/meal-fit'

const target = { calories: 2000, proteinG: 150, carbsG: 200, fatG: 67 }

describe('evaluateMealFit', () => {
  it('returns null when no target is set', () => {
    const result = evaluateMealFit({
      totals: { calories: 500, proteinG: 40, carbsG: 50, fatG: 15 },
      meal: { calories: 600, proteinG: 45, carbsG: 60, fatG: 20 },
      target: null,
    })

    expect(result).toBeNull()
  })

  it('reports a fit when the meal keeps every macro at or under target', () => {
    const result = evaluateMealFit({
      totals: { calories: 800, proteinG: 60, carbsG: 80, fatG: 25 },
      meal: { calories: 600, proteinG: 45, carbsG: 60, fatG: 20 },
      target,
    })

    expect(result!.calories.projected).toBe(1400)
    expect(result!.calories.fits).toBe(true)
    expect(result!.calories.overBy).toBe(0)
    expect(result!.proteinG.fits).toBe(true)
    expect(result!.fatG.fits).toBe(true)
  })

  it('reports the overshoot per macro when the meal pushes past target', () => {
    const result = evaluateMealFit({
      totals: { calories: 1700, proteinG: 140, carbsG: 190, fatG: 60 },
      meal: { calories: 600, proteinG: 45, carbsG: 60, fatG: 20 },
      target,
    })

    expect(result!.calories.projected).toBe(2300)
    expect(result!.calories.fits).toBe(false)
    expect(result!.calories.overBy).toBe(300)
    expect(result!.proteinG.overBy).toBe(35)
    expect(result!.carbsG.overBy).toBe(50)
    expect(result!.fatG.overBy).toBe(13)
  })

  it('treats landing exactly on target as fitting', () => {
    const result = evaluateMealFit({
      totals: { calories: 1400, proteinG: 105, carbsG: 140, fatG: 47 },
      meal: { calories: 600, proteinG: 45, carbsG: 60, fatG: 20 },
      target,
    })

    expect(result!.calories.projected).toBe(2000)
    expect(result!.calories.fits).toBe(true)
    expect(result!.calories.overBy).toBe(0)
  })

  it('carries consumed and target through untouched for rendering', () => {
    const result = evaluateMealFit({
      totals: { calories: 800, proteinG: 60, carbsG: 80, fatG: 25 },
      meal: { calories: 600, proteinG: 45, carbsG: 60, fatG: 20 },
      target,
    })

    expect(result!.proteinG.consumed).toBe(60)
    expect(result!.proteinG.meal).toBe(45)
    expect(result!.proteinG.target).toBe(150)
  })

  // Totals arrive as unrounded floats (ingredient macros are scaled by quantity/100), so
  // the comparison has to round before deciding -- otherwise a projected 2000.4 against a
  // 2000 target reads as "over by 0", showing an overshoot warning for a rounding artifact.
  it('rounds before comparing so float drift does not read as an overshoot', () => {
    const result = evaluateMealFit({
      totals: { calories: 1400.3, proteinG: 105.1, carbsG: 140.2, fatG: 47.4 },
      meal: { calories: 599.9, proteinG: 44.8, carbsG: 59.7, fatG: 19.5 },
      target,
    })

    expect(result!.calories.fits).toBe(true)
    expect(result!.calories.overBy).toBe(0)
    expect(result!.calories.projected).toBe(2000)
  })
})
