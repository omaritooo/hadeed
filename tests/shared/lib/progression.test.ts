import { describe, expect, it } from 'vitest'
import { lbsToKg } from '~~/shared/lib/formulas'
import { prefillForSet, suggestProgression, workingWeight, type ProgressionInput, type ProgressionSuggestion, type WorkingSet } from '~~/shared/lib/progression'

const set = (weightKg: number | null, reps: number | null, rpe: number | null = null): WorkingSet => ({ weightKg, reps, rpe })

const bench = (overrides: Partial<ProgressionInput> = {}): ProgressionInput => ({
  prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: null },
  recentSessions: [],
  setType: 'weight_reps',
  equipment: 'barbell',
  movementPattern: 'horizontal_push',
  unitSystem: 'metric',
  ...overrides,
})

describe('workingWeight', () => {
  it('ignores a single heavy top set', () => {
    expect(workingWeight([set(100, 3), set(80, 10), set(80, 10), set(80, 10)])).toBe(80)
  })

  it('returns null when no weights were logged', () => {
    expect(workingWeight([set(null, 10)])).toBeNull()
  })
})

describe('suggestProgression', () => {
  it('returns null for time-based exercises', () => {
    expect(suggestProgression(bench({ setType: 'time', recentSessions: [[set(null, null)]] }))).toBeNull()
  })

  it('returns null when the prescription has no rep range', () => {
    expect(suggestProgression(bench({ prescription: { sets: 3, repsMin: null, repsMax: null, rpe: null } }))).toBeNull()
  })

  it('returns null for an open-ended rep range', () => {
    expect(suggestProgression(bench({
      prescription: { sets: 3, repsMin: 8, repsMax: null, rpe: null },
      recentSessions: [[set(60, 10), set(60, 10), set(60, 10)]],
    }))).toBeNull()
  })

  it('marks an exercise with no history as first_time, with no weight', () => {
    expect(suggestProgression(bench())).toEqual({ action: 'first_time', reason: 'first_time', weightKg: null, repsMin: 8, repsMax: 10 })
  })

  it('adds 2.5kg to an upper-body barbell lift once every set hits the top of the range', () => {
    const result = suggestProgression(bench({ recentSessions: [[set(60, 10), set(60, 10), set(60, 10)]] }))
    expect(result).toEqual({ action: 'increase', reason: 'all_sets_top_of_range', weightKg: 62.5, repsMin: 8, repsMax: 10 })
  })

  it('adds 5kg to a lower-body barbell lift', () => {
    const result = suggestProgression(bench({ movementPattern: 'knee_dominant', recentSessions: [[set(100, 10), set(100, 10), set(100, 10)]] }))
    expect(result?.weightKg).toBe(105)
  })

  it('adds 2kg to a dumbbell lift', () => {
    const result = suggestProgression(bench({ equipment: 'dumbbell', recentSessions: [[set(20, 10), set(20, 10), set(20, 10)]] }))
    expect(result?.weightKg).toBe(22)
  })

  it('rounds in pounds for imperial users and stores kg', () => {
    // 100kg = 220.46lb → snaps to 220lb, +5lb = 225lb
    const result = suggestProgression(bench({ unitSystem: 'imperial', recentSessions: [[set(100, 10), set(100, 10), set(100, 10)]] }))
    expect(result?.weightKg).toBeCloseTo(lbsToKg(225), 6)
  })

  it('holds and builds reps when not every set reached the top', () => {
    const result = suggestProgression(bench({ recentSessions: [[set(60, 10), set(60, 9), set(60, 8)]] }))
    expect(result).toEqual({ action: 'hold', reason: 'building_reps', weightKg: 60, repsMin: 8, repsMax: 10 })
  })

  it('holds when fewer sets than prescribed were logged, even at the top of the range', () => {
    const result = suggestProgression(bench({ recentSessions: [[set(60, 10), set(60, 10)]] }))
    expect(result?.action).toBe('hold')
  })

  it('uses the logged set count when the prescription has no set count', () => {
    const result = suggestProgression(bench({
      prescription: { sets: null, repsMin: 8, repsMax: 10, rpe: null },
      recentSessions: [[set(60, 10), set(60, 10)]],
    }))
    expect(result?.action).toBe('increase')
  })

  it('holds when average RPE is well above target, even with every set at the top', () => {
    const result = suggestProgression(bench({
      prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: 7 },
      recentSessions: [[set(60, 10, 9), set(60, 10, 9), set(60, 10, 8.5)]],
    }))
    expect(result).toMatchObject({ action: 'hold', reason: 'rpe_too_high', weightKg: 60 })
  })

  it('still increases when RPE is only slightly above target', () => {
    const result = suggestProgression(bench({
      prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: 7 },
      recentSessions: [[set(60, 10, 7.5), set(60, 10, 7.5), set(60, 10, 7.5)]],
    }))
    expect(result?.action).toBe('increase')
  })

  it('increases when RPE is far below target and every set reached the bottom of the range', () => {
    const result = suggestProgression(bench({
      prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: 8 },
      recentSessions: [[set(60, 8, 5), set(60, 8, 6), set(60, 8, 6)]],
    }))
    expect(result).toMatchObject({ action: 'increase', reason: 'rpe_too_low', weightKg: 62.5 })
  })

  it('reduces by ~10% after missing the bottom of the range two sessions running', () => {
    const result = suggestProgression(bench({
      recentSessions: [
        [set(100, 8), set(100, 7), set(100, 6)],
        [set(100, 8), set(100, 6), set(100, 6)],
      ],
    }))
    expect(result).toEqual({ action: 'reduce', reason: 'missed_min_twice', weightKg: 90, repsMin: 8, repsMax: 10 })
  })

  it('does not reduce after a single session below the range', () => {
    const result = suggestProgression(bench({
      recentSessions: [
        [set(100, 8), set(100, 7), set(100, 6)],
        [set(100, 10), set(100, 9), set(100, 8)],
      ],
    }))
    expect(result?.action).toBe('hold')
  })

  it('checks missed-min-twice before RPE', () => {
    const result = suggestProgression(bench({
      prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: 7 },
      recentSessions: [
        [set(100, 6, 10), set(100, 6, 10), set(100, 6, 10)],
        [set(100, 7, 10), set(100, 6, 10), set(100, 6, 10)],
      ],
    }))
    expect(result?.action).toBe('reduce')
  })

  it('progresses bodyweight exercises by reps, never weight', () => {
    const result = suggestProgression(bench({
      setType: 'bodyweight_reps',
      equipment: 'body only',
      recentSessions: [[set(null, 10), set(null, 10), set(null, 10)]],
    }))
    expect(result).toEqual({ action: 'increase', reason: 'all_sets_top_of_range', weightKg: null, repsMin: 11, repsMax: 12 })
  })

  it('holds rather than reducing a bodyweight exercise', () => {
    const result = suggestProgression(bench({
      setType: 'bodyweight_reps',
      recentSessions: [[set(null, 5)], [set(null, 5)]],
    }))
    expect(result).toMatchObject({ action: 'hold', reason: 'missed_min_twice', weightKg: null })
  })
})

describe('prefillForSet', () => {
  const suggestion = (overrides: Partial<ProgressionSuggestion> = {}): ProgressionSuggestion => ({
    action: 'increase',
    reason: 'all_sets_top_of_range',
    weightKg: 62.5,
    repsMin: 8,
    repsMax: 10,
    ...overrides,
  })

  it('leaves the fallback alone when there is no suggestion', () => {
    expect(prefillForSet(null, { weightKg: 60, reps: 9 }, true)).toEqual({ weightKg: 60, reps: 9 })
    expect(prefillForSet(null, null, true)).toBeNull()
  })

  it('leaves the fallback alone when holding or lifting for the first time', () => {
    const fallback = { weightKg: 60, reps: 9 }
    expect(prefillForSet(suggestion({ action: 'hold', reason: 'building_reps' }), fallback, true)).toEqual(fallback)
    expect(prefillForSet(suggestion({ action: 'first_time', reason: 'first_time', weightKg: null }), fallback, true)).toEqual(fallback)
  })

  // Once the load moves, last session's per-set weights no longer describe today -- including
  // ramping patterns, where every set gets the new working weight to adjust from.
  it('overrides both weight and reps when the load changes', () => {
    expect(prefillForSet(suggestion(), { weightKg: 60, reps: 10 }, true)).toEqual({ weightKg: 62.5, reps: 8 })
    expect(prefillForSet(suggestion({ action: 'reduce', reason: 'missed_min_twice', weightKg: 55 }), { weightKg: 60, reps: 10 }, true))
      .toEqual({ weightKg: 55, reps: 8 })
  })

  it('fills a changed load even with no history to fall back on', () => {
    expect(prefillForSet(suggestion(), null, true)).toEqual({ weightKg: 62.5, reps: 8 })
  })

  // Bodyweight and time set types never carry a suggested load, so only the reps move.
  it('keeps the fallback weight when the suggestion carries no load', () => {
    expect(prefillForSet(suggestion({ weightKg: null, repsMin: 11 }), { weightKg: null, reps: 10 }, true))
      .toEqual({ weightKg: null, reps: 11 })
    expect(prefillForSet(suggestion({ weightKg: null, repsMin: 11 }), null, true)).toEqual({ weightKg: null, reps: 11 })
  })
})

describe('prefillForSet after the first working set', () => {
  const increase: ProgressionSuggestion = { action: 'increase', reason: 'all_sets_top_of_range', weightKg: 62.5, repsMin: 8, repsMax: 10 }

  // The lifter who went to 65 after a suggested 62.5 meant it; set two should not retype over it.
  it('keeps what was just lifted rather than re-asserting the suggestion', () => {
    expect(prefillForSet(increase, { weightKg: 65, reps: 9 }, false)).toEqual({ weightKg: 65, reps: 9 })
  })

  it('still fills nothing when there is nothing to carry over', () => {
    expect(prefillForSet(increase, null, false)).toBeNull()
  })
})
