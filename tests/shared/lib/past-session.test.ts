import { describe, expect, it } from 'vitest'
import { pastSessionTimestamps, validatePastSession } from '~~/shared/lib/past-session'
import type { PastSessionInput } from '~~/shared/types/session.types'

const NOW = new Date('2026-09-21T10:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

const input = (overrides: Partial<PastSessionInput> = {}): PastSessionInput => ({
  id: 's1',
  startedAt: daysAgo(2),
  splitDayId: null,
  exercises: [{
    id: 'e1', exerciseId: 'bench-press', splitExerciseId: null, setType: 'weight_reps',
    targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRpe: null,
    sets: 3, reps: 10, weightKg: 60,
  }],
  ...overrides,
})

describe('validatePastSession', () => {
  it('accepts today and 14 days back', () => {
    expect(validatePastSession(input({ startedAt: NOW.toISOString() }), NOW)).toBeNull()
    expect(validatePastSession(input({ startedAt: daysAgo(14) }), NOW)).toBeNull()
  })

  it('rejects the future', () => {
    expect(validatePastSession(input({ startedAt: new Date(NOW.getTime() + 3_600_000).toISOString() }), NOW)).toMatch(/future/)
  })

  it('rejects anything past the window plus a day of timezone slack', () => {
    expect(validatePastSession(input({ startedAt: daysAgo(16) }), NOW)).toMatch(/14 days/)
  })

  it('rejects an unparseable date', () => {
    expect(validatePastSession(input({ startedAt: 'yesterday' }), NOW)).toMatch(/startedAt/)
  })

  it('rejects an empty workout and an exercise with no sets', () => {
    expect(validatePastSession(input({ exercises: [] }), NOW)).toMatch(/exercise/)
    expect(validatePastSession(input({ exercises: [{ ...input().exercises[0]!, sets: 0 }] }), NOW)).toMatch(/set/)
  })

  it('rejects a weighted exercise with no weight or reps', () => {
    expect(validatePastSession(input({ exercises: [{ ...input().exercises[0]!, weightKg: null }] }), NOW)).toMatch(/weight/)
    expect(validatePastSession(input({ exercises: [{ ...input().exercises[0]!, reps: null }] }), NOW)).toMatch(/reps/)
  })
})

describe('pastSessionTimestamps', () => {
  it('spaces sets one second apart after the start and completes one second after the last', () => {
    const start = new Date('2026-09-16T07:45:00Z')
    const { startedAt, setTimes, completedAt } = pastSessionTimestamps(start, 3, NOW)
    expect(startedAt.toISOString()).toBe('2026-09-16T07:45:00.000Z')
    expect(setTimes.map(t => t.toISOString())).toEqual([
      '2026-09-16T07:45:01.000Z', '2026-09-16T07:45:02.000Z', '2026-09-16T07:45:03.000Z',
    ])
    expect(completedAt.toISOString()).toBe('2026-09-16T07:45:04.000Z')
  })

  it('pulls a start of "now" back so no set lands in the future', () => {
    const { completedAt } = pastSessionTimestamps(NOW, 5, NOW)
    expect(completedAt.getTime()).toBeLessThanOrEqual(NOW.getTime())
  })
})
