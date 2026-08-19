import { describe, expect, it } from 'vitest'
import { bmi, tdee, xpToLevel } from '~~/shared/lib/formulas'

describe('bmi', () => {
  it('computes weight_kg / height_m^2', () => {
    expect(bmi({ weightKg: 70, heightCm: 175 })).toBeCloseTo(22.86, 1)
  })
})

describe('tdee', () => {
  it('computes Mifflin-St Jeor for a male, moderately active', () => {
    // BMR = 10*70 + 6.25*175 - 5*30 + 5 = 700 + 1093.75 - 150 + 5 = 1648.75
    // TDEE = BMR * 1.55 (moderately_active)
    const result = tdee({
      weightKg: 70,
      heightCm: 175,
      age: 30,
      gender: 'male',
      activityLevel: 'moderately_active',
    })
    expect(result).toBeCloseTo(1648.75 * 1.55, 0)
  })

  it('computes Mifflin-St Jeor for a female, sedentary', () => {
    // BMR = 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25
    const result = tdee({
      weightKg: 60,
      heightCm: 165,
      age: 25,
      gender: 'female',
      activityLevel: 'sedentary',
    })
    expect(result).toBeCloseTo(1345.25 * 1.2, 0)
  })

  it('averages male/female constants for gender "other"', () => {
    const male = tdee({ weightKg: 70, heightCm: 175, age: 30, gender: 'male', activityLevel: 'sedentary' })
    const female = tdee({ weightKg: 70, heightCm: 175, age: 30, gender: 'female', activityLevel: 'sedentary' })
    const other = tdee({ weightKg: 70, heightCm: 175, age: 30, gender: 'other', activityLevel: 'sedentary' })
    expect(other).toBeCloseTo((male + female) / 2, 5)
  })
})

describe('xpToLevel', () => {
  it('returns level 1 at 0 xp', () => {
    expect(xpToLevel(0)).toBe(1)
  })

  it('increases with more xp', () => {
    expect(xpToLevel(5000)).toBeGreaterThan(xpToLevel(100))
  })

  it('never returns a level below 1', () => {
    expect(xpToLevel(-100)).toBe(1)
  })
})
