import { describe, expect, it } from 'vitest'
import { equipmentSatisfies } from '~~/shared/lib/equipment'

describe('equipmentSatisfies', () => {
  it('a tier satisfies itself and any lower tier requirement', () => {
    expect(equipmentSatisfies('full_gym', 'home_dumbbell_only')).toBe(true)
    expect(equipmentSatisfies('home_barbell_dumbbell', 'home_dumbbell_only')).toBe(true)
    expect(equipmentSatisfies('bodyweight', 'bodyweight')).toBe(true)
  })

  it('a lower tier does not satisfy a higher requirement', () => {
    expect(equipmentSatisfies('bodyweight', 'full_gym')).toBe(false)
    expect(equipmentSatisfies('home_dumbbell_only', 'home_barbell_dumbbell')).toBe(false)
  })

  it('a preset requiring "both" is satisfied by every user tier', () => {
    expect(equipmentSatisfies('bodyweight', 'both')).toBe(true)
    expect(equipmentSatisfies('full_gym', 'both')).toBe(true)
  })
})
