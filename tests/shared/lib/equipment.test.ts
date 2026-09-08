import { describe, expect, it } from 'vitest'
import { equipmentSatisfies, equipmentValuesForTier, exerciseEquipmentSatisfiesTier } from '~~/shared/lib/equipment'

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

describe('equipmentValuesForTier', () => {
  it('each tier is a strict superset of the tier below it', () => {
    const bodyweight = equipmentValuesForTier('bodyweight')
    const dumbbellOnly = equipmentValuesForTier('home_dumbbell_only')
    const barbellDumbbell = equipmentValuesForTier('home_barbell_dumbbell')
    const fullGym = equipmentValuesForTier('full_gym')

    expect(bodyweight.every(v => dumbbellOnly.includes(v))).toBe(true)
    expect(dumbbellOnly.every(v => barbellDumbbell.includes(v))).toBe(true)
    expect(barbellDumbbell.every(v => fullGym.includes(v))).toBe(true)

    expect(dumbbellOnly.length).toBeGreaterThan(bodyweight.length)
    expect(barbellDumbbell.length).toBeGreaterThan(dumbbellOnly.length)
    expect(fullGym.length).toBeGreaterThan(barbellDumbbell.length)
  })

  it('bodyweight tier is limited to body-only training plus cheap accessories', () => {
    expect(equipmentValuesForTier('bodyweight')).toEqual(expect.arrayContaining(['body only', 'bands', 'foam roll', null]))
    expect(equipmentValuesForTier('bodyweight')).not.toEqual(expect.arrayContaining(['dumbbell', 'barbell']))
  })

  it('full_gym tier includes every equipment value in the seeded dataset', () => {
    const fullGym = equipmentValuesForTier('full_gym')
    for (const value of ['body only', 'machine', 'other', 'foam roll', 'kettlebells', 'dumbbell', 'cable', 'barbell', 'bands', 'medicine ball', 'exercise ball', 'e-z curl bar', null]) {
      expect(fullGym).toContain(value)
    }
  })

  it('"both" fails open to the full_gym list', () => {
    expect(equipmentValuesForTier('both')).toEqual(equipmentValuesForTier('full_gym'))
  })
})

describe('exerciseEquipmentSatisfiesTier', () => {
  it('a bodyweight tier cannot train a barbell exercise', () => {
    expect(exerciseEquipmentSatisfiesTier({ equipment: 'barbell', tier: 'bodyweight' })).toBe(false)
  })

  it('a full_gym tier can train a barbell exercise', () => {
    expect(exerciseEquipmentSatisfiesTier({ equipment: 'barbell', tier: 'full_gym' })).toBe(true)
  })

  it('null equipment always satisfies, at any tier', () => {
    expect(exerciseEquipmentSatisfiesTier({ equipment: null, tier: 'bodyweight' })).toBe(true)
    expect(exerciseEquipmentSatisfiesTier({ equipment: null, tier: 'full_gym' })).toBe(true)
  })

  it('a home_dumbbell_only tier can train dumbbell and kettlebell exercises but not barbell', () => {
    expect(exerciseEquipmentSatisfiesTier({ equipment: 'dumbbell', tier: 'home_dumbbell_only' })).toBe(true)
    expect(exerciseEquipmentSatisfiesTier({ equipment: 'kettlebells', tier: 'home_dumbbell_only' })).toBe(true)
    expect(exerciseEquipmentSatisfiesTier({ equipment: 'barbell', tier: 'home_dumbbell_only' })).toBe(false)
  })
})
