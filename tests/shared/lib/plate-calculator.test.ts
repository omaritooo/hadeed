import { describe, expect, it } from 'vitest'
import {
  calculatePlatesPerSide,
  DEFAULT_BAR_WEIGHT_KG,
  DEFAULT_BAR_WEIGHT_LB,
  defaultBarWeightForUnitSystem,
  KG_PLATES,
  LB_PLATES,
  plateSetForUnitSystem,
} from '~~/shared/lib/plate-calculator'

describe('calculatePlatesPerSide', () => {
  it('picks the largest plates first for a target reachable exactly (100kg, 20kg bar)', () => {
    const result = calculatePlatesPerSide({ targetTotal: 100, barWeight: 20, plateSet: KG_PLATES })
    expect(result.platesPerSide).toEqual([25, 15])
    expect(result.achievedTotal).toBe(100)
    expect(result.remainder).toBe(0)
  })

  it('falls back to the closest achievable total plus a remainder for an odd target (102kg, 20kg bar)', () => {
    const result = calculatePlatesPerSide({ targetTotal: 102, barWeight: 20, plateSet: KG_PLATES })
    expect(result.platesPerSide).toEqual([25, 15])
    expect(result.achievedTotal).toBe(100)
    expect(result.remainder).toBe(2)
  })

  it('assumes unlimited plates per size, so it greedily prefers two 45s over 45+35+10 for 225lb', () => {
    const result = calculatePlatesPerSide({ targetTotal: 225, barWeight: 45, plateSet: LB_PLATES })
    expect(result.platesPerSide).toEqual([45, 45])
    expect(result.achievedTotal).toBe(225)
    expect(result.remainder).toBe(0)
  })

  it('respects an overridden (non-standard) bar weight', () => {
    const result = calculatePlatesPerSide({ targetTotal: 100, barWeight: 15, plateSet: KG_PLATES })
    expect(result.platesPerSide).toEqual([25, 15, 2.5])
    expect(result.achievedTotal).toBe(100)
    expect(result.remainder).toBe(0)
  })

  it('needs no plates when the target is at or below the bar weight alone', () => {
    const result = calculatePlatesPerSide({ targetTotal: 15, barWeight: 20, plateSet: KG_PLATES })
    expect(result.platesPerSide).toEqual([])
    expect(result.achievedTotal).toBe(20)
    expect(result.remainder).toBe(-5)
  })

  it('defaults to the kg plate set when none is given', () => {
    const result = calculatePlatesPerSide({ targetTotal: 60, barWeight: 20 })
    expect(result.platesPerSide).toEqual([20])
    expect(result.achievedTotal).toBe(60)
  })
})

describe('plateSetForUnitSystem / defaultBarWeightForUnitSystem', () => {
  it('maps metric to the kg plate set and a 20kg bar', () => {
    expect(plateSetForUnitSystem('metric')).toEqual(KG_PLATES)
    expect(defaultBarWeightForUnitSystem('metric')).toBe(DEFAULT_BAR_WEIGHT_KG)
  })

  it('maps imperial to the lb plate set and a 45lb bar', () => {
    expect(plateSetForUnitSystem('imperial')).toEqual(LB_PLATES)
    expect(defaultBarWeightForUnitSystem('imperial')).toBe(DEFAULT_BAR_WEIGHT_LB)
  })
})
