import { describe, expect, it } from 'vitest'
import { checkRecoveryConflicts } from '~~/shared/lib/recovery-checker'

const day = (overrides: Partial<{ isRestDay: boolean, exercises: { tier: number | null, primaryMuscle: string | null }[] }> = {}) => ({
  isRestDay: false,
  exercises: [],
  ...overrides,
})

describe('checkRecoveryConflicts', () => {
  it('flags two consecutive non-rest days sharing a Tier 1 exercise on the same primary muscle', () => {
    const days = [
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
    ]
    const conflicts = checkRecoveryConflicts(days)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ muscle: 'chest', dayIndexes: [0, 1] })
  })

  it('does not flag when a rest day separates two Tier 1 chest days', () => {
    const days = [
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
      day({ isRestDay: true, exercises: [] }),
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
    ]
    expect(checkRecoveryConflicts(days)).toHaveLength(0)
  })

  it('does not flag when the shared exercise is Tier 2 or 3', () => {
    const days = [
      day({ exercises: [{ tier: 2, primaryMuscle: 'chest' }] }),
      day({ exercises: [{ tier: 2, primaryMuscle: 'chest' }] }),
    ]
    expect(checkRecoveryConflicts(days)).toHaveLength(0)
  })

  it('does not flag consecutive Tier 1 days targeting different muscles', () => {
    const days = [
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
      day({ exercises: [{ tier: 1, primaryMuscle: 'quadriceps' }] }),
    ]
    expect(checkRecoveryConflicts(days)).toHaveLength(0)
  })

  it('returns an empty array for an empty days list', () => {
    expect(checkRecoveryConflicts([])).toHaveLength(0)
  })

  it('returns an empty array for a single day', () => {
    const days = [day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] })]
    expect(checkRecoveryConflicts(days)).toHaveLength(0)
  })

  it('does not duplicate conflicts when a day has multiple Tier 1 exercises for the same muscle', () => {
    const days = [
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
      day({
        exercises: [
          { tier: 1, primaryMuscle: 'chest' },
          { tier: 1, primaryMuscle: 'chest' },
        ],
      }),
    ]
    const conflicts = checkRecoveryConflicts(days)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ muscle: 'chest', dayIndexes: [0, 1] })
  })

  it('flags each adjacent pair when 3+ consecutive training days share a Tier 1 muscle', () => {
    const days = [
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
    ]
    const conflicts = checkRecoveryConflicts(days)
    expect(conflicts).toHaveLength(2)
    expect(conflicts[0]).toMatchObject({ muscle: 'chest', dayIndexes: [0, 1] })
    expect(conflicts[1]).toMatchObject({ muscle: 'chest', dayIndexes: [1, 2] })
  })

  it('flags multiple distinct muscles shared between the same pair of days', () => {
    const days = [
      day({
        exercises: [
          { tier: 1, primaryMuscle: 'chest' },
          { tier: 1, primaryMuscle: 'triceps' },
        ],
      }),
      day({
        exercises: [
          { tier: 1, primaryMuscle: 'chest' },
          { tier: 1, primaryMuscle: 'triceps' },
        ],
      }),
    ]
    const conflicts = checkRecoveryConflicts(days)
    expect(conflicts).toHaveLength(2)
    expect(conflicts.map(c => c.muscle).sort()).toEqual(['chest', 'triceps'])
  })

  it('treats a null primaryMuscle as never conflicting', () => {
    const days = [
      day({ exercises: [{ tier: 1, primaryMuscle: null }] }),
      day({ exercises: [{ tier: 1, primaryMuscle: null }] }),
    ]
    expect(checkRecoveryConflicts(days)).toHaveLength(0)
  })

  it('ignores a null tier for conflict purposes', () => {
    const days = [
      day({ exercises: [{ tier: null, primaryMuscle: 'chest' }] }),
      day({ exercises: [{ tier: null, primaryMuscle: 'chest' }] }),
    ]
    expect(checkRecoveryConflicts(days)).toHaveLength(0)
  })
})
