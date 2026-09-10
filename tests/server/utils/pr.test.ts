import { describe, expect, it } from 'vitest'
import { isNewPersonalRecord } from '~~/server/utils/pr'

describe('isNewPersonalRecord', () => {
  it('is never a PR for a warm-up set, even one heavier than any previous best', () => {
    expect(isNewPersonalRecord({ weightKg: 200, isWarmup: true }, 100)).toBe(false)
    expect(isNewPersonalRecord({ weightKg: 200, isWarmup: true }, null)).toBe(false)
  })

  it('is a PR for a working set that beats the previous best', () => {
    expect(isNewPersonalRecord({ weightKg: 101, isWarmup: false }, 100)).toBe(true)
  })

  it('is a PR for the first working set ever logged (no previous best)', () => {
    expect(isNewPersonalRecord({ weightKg: 60, isWarmup: false }, null)).toBe(true)
  })

  it('is not a PR for a working set that ties or falls short of the previous best', () => {
    expect(isNewPersonalRecord({ weightKg: 100, isWarmup: false }, 100)).toBe(false)
    expect(isNewPersonalRecord({ weightKg: 90, isWarmup: false }, 100)).toBe(false)
  })

  it('is not a PR for a bodyweight/time-based set with no weight logged', () => {
    expect(isNewPersonalRecord({ weightKg: null, isWarmup: false }, null)).toBe(false)
  })
})
