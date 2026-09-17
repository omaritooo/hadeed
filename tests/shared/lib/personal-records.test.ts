import { describe, expect, it } from 'vitest'
import { detectPersonalRecords, estimateOneRepMax } from '~~/shared/lib/personal-records'

const working = (weightKg: number, reps: number) => ({ weightKg, reps, isWarmup: false })

describe('estimateOneRepMax', () => {
  it('uses Epley', () => {
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.667, 3)
  })
})

describe('detectPersonalRecords', () => {
  it('never counts a first-ever set as a PR', () => {
    expect(detectPersonalRecords(working(100, 5), [])).toEqual([])
  })

  it('never counts a warm-up', () => {
    expect(detectPersonalRecords({ weightKg: 200, reps: 5, isWarmup: true }, [{ weightKg: 100, reps: 5 }])).toEqual([])
  })

  it('detects a weight PR (and the e1RM PR it implies)', () => {
    const prs = detectPersonalRecords(working(105, 5), [{ weightKg: 100, reps: 5 }])
    expect(prs.map(p => p.type).sort()).toEqual(['e1rm', 'weight'])
    expect(prs.find(p => p.type === 'weight')).toEqual({ type: 'weight', value: 105, previousValue: 100 })
  })

  it('detects a rep PR at the same weight', () => {
    const prs = detectPersonalRecords(working(100, 7), [{ weightKg: 100, reps: 5 }, { weightKg: 90, reps: 10 }])
    expect(prs.find(p => p.type === 'reps')).toEqual({ type: 'reps', value: 7, previousValue: 5 })
    expect(prs.find(p => p.type === 'weight')).toBeUndefined()
  })

  it('compares reps against sets at this weight or heavier only', () => {
    // 12 reps at 90 was done before, but never at >= 100kg -> 6 reps at 100 beats the 100kg best of 5
    const prs = detectPersonalRecords(working(100, 6), [{ weightKg: 100, reps: 5 }, { weightKg: 90, reps: 12 }])
    expect(prs.find(p => p.type === 'reps')?.previousValue).toBe(5)
  })

  it('treats a heavier prior set with more reps as blocking a rep PR', () => {
    expect(detectPersonalRecords(working(100, 6), [{ weightKg: 110, reps: 8 }]).find(p => p.type === 'reps')).toBeUndefined()
  })

  it('detects an e1RM PR alongside a rep PR when a lighter, longer set is beaten on estimated max', () => {
    // priors: 100x5 (e1RM 116.7) and 90x10 (120.0); new 95x8 is e1RM 120.33
    const prs = detectPersonalRecords(working(95, 8), [{ weightKg: 100, reps: 5 }, { weightKg: 90, reps: 10 }])
    expect(prs.map(p => p.type).sort()).toEqual(['e1rm', 'reps'])
    expect(prs.find(p => p.type === 'e1rm')).toEqual({ type: 'e1rm', value: 120.3, previousValue: 120 })
  })

  it('blocks an e1RM PR when a lighter, higher-rep set already estimates higher', () => {
    // 90x12 estimates 126.0, above 95x8's 120.33, so only the rep PR stands
    const prs = detectPersonalRecords(working(95, 8), [{ weightKg: 100, reps: 5 }, { weightKg: 90, reps: 12 }])
    expect(prs.map(p => p.type)).toEqual(['reps'])
  })

  it('ignores sets above 12 reps for e1RM, on either side', () => {
    expect(detectPersonalRecords(working(60, 20), [{ weightKg: 100, reps: 3 }]).find(p => p.type === 'e1rm')).toBeUndefined()
    expect(detectPersonalRecords(working(80, 5), [{ weightKg: 70, reps: 20 }]).find(p => p.type === 'e1rm')).toBeUndefined()
  })

  it('returns nothing for a set without weight or reps', () => {
    expect(detectPersonalRecords({ weightKg: null, reps: 10, isWarmup: false }, [{ weightKg: 50, reps: 5 }])).toEqual([])
  })
})
