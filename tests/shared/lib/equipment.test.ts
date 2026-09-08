import { describe, expect, it } from 'vitest'
import { equipmentSatisfies } from '~~/shared/lib/equipment'

describe('equipmentSatisfies', () => {
  it('a tier satisfies itself and any lower tier requirement', () => {
    expect(equipmentSatisfies({ userTier: 'full_gym', required: 'home_dumbbell_only' })).toBe(true)
    expect(equipmentSatisfies({ userTier: 'home_barbell_dumbbell', required: 'home_dumbbell_only' })).toBe(true)
    expect(equipmentSatisfies({ userTier: 'bodyweight', required: 'bodyweight' })).toBe(true)
  })

  it('a lower tier does not satisfy a higher requirement', () => {
    expect(equipmentSatisfies({ userTier: 'bodyweight', required: 'full_gym' })).toBe(false)
    expect(equipmentSatisfies({ userTier: 'home_dumbbell_only', required: 'home_barbell_dumbbell' })).toBe(false)
  })

  it('a preset requiring "both" is satisfied by every user tier', () => {
    expect(equipmentSatisfies({ userTier: 'bodyweight', required: 'both' })).toBe(true)
    expect(equipmentSatisfies({ userTier: 'full_gym', required: 'both' })).toBe(true)
  })
})
