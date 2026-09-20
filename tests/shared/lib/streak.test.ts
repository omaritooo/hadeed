import { describe, expect, it } from 'vitest'
import { buildStreakWeeks, computeWeekStreak, requiredSessions, type StreakWeek } from '~~/shared/lib/streak'

const week = (weekStart: string, scheduled: number, completed: number): StreakWeek => ({ weekStart, scheduled, completed })

describe('requiredSessions', () => {
  it('allows one missed session per week, never requiring fewer than one', () => {
    expect(requiredSessions(1)).toBe(1)
    expect(requiredSessions(2)).toBe(1)
    expect(requiredSessions(5)).toBe(4)
  })
})

describe('computeWeekStreak', () => {
  it('counts consecutive hit weeks ending at the last finished week', () => {
    const result = computeWeekStreak([
      week('2026-08-17', 3, 0),
      week('2026-08-24', 3, 2),
      week('2026-08-31', 3, 3),
    ], '2026-09-07')
    expect(result.current).toBe(2)
    expect(result.longest).toBe(2)
  })

  it('resets on a missed week', () => {
    expect(computeWeekStreak([week('2026-08-24', 3, 3), week('2026-08-31', 3, 1)], '2026-09-07').current).toBe(0)
  })

  it('skips neutral weeks without breaking the streak', () => {
    expect(computeWeekStreak([
      week('2026-08-17', 3, 3),
      week('2026-08-24', 0, 0),
      week('2026-08-31', 3, 2),
    ], '2026-09-07').current).toBe(2)
  })

  it('adds the in-progress week once it is hit', () => {
    const result = computeWeekStreak([week('2026-08-31', 3, 3), week('2026-09-07', 3, 2)], '2026-09-07')
    expect(result.current).toBe(2)
    expect(result.thisWeek).toEqual({ completed: 2, required: 2, scheduled: 3 })
  })

  it('never breaks the streak with an in-progress week that is not yet hit', () => {
    const result = computeWeekStreak([week('2026-08-31', 3, 3), week('2026-09-07', 3, 0)], '2026-09-07')
    expect(result.current).toBe(1)
    expect(result.thisWeek).toEqual({ completed: 0, required: 2, scheduled: 3 })
  })

  it('tracks a longest streak longer than the current one', () => {
    const result = computeWeekStreak([
      week('2026-08-03', 2, 1),
      week('2026-08-10', 2, 2),
      week('2026-08-17', 2, 1),
      week('2026-08-24', 2, 0),
      week('2026-08-31', 2, 2),
    ], '2026-09-07')
    expect(result).toMatchObject({ current: 1, longest: 3 })
  })

  it('reports zeros with no history', () => {
    expect(computeWeekStreak([], '2026-09-07')).toEqual({ current: 0, longest: 0, thisWeek: { completed: 0, required: 0, scheduled: 0 } })
  })

  it('still needs the one session of a one-day split', () => {
    expect(computeWeekStreak([week('2026-08-31', 1, 0)], '2026-09-07').current).toBe(0)
    expect(computeWeekStreak([week('2026-08-31', 1, 1)], '2026-09-07').current).toBe(1)
  })

  it('lets one session carry a two-day split but needs four on a five-day one', () => {
    expect(computeWeekStreak([week('2026-08-31', 2, 1)], '2026-09-07').current).toBe(1)
    expect(computeWeekStreak([week('2026-08-31', 5, 3)], '2026-09-07').current).toBe(0)
    expect(computeWeekStreak([week('2026-08-31', 5, 4)], '2026-09-07').current).toBe(1)
  })

  it('counts a week trained beyond its schedule', () => {
    expect(computeWeekStreak([week('2026-08-31', 3, 5)], '2026-09-07').current).toBe(1)
  })

  it('carries longest across a neutral week between hit weeks', () => {
    const result = computeWeekStreak([
      week('2026-08-17', 3, 3),
      week('2026-08-24', 0, 0),
      week('2026-08-31', 3, 3),
    ], '2026-09-07')
    expect(result.longest).toBe(2)
  })

  it('follows the requirement as the block changes size', () => {
    const result = computeWeekStreak([
      week('2026-08-17', 2, 1),
      week('2026-08-24', 5, 3),
      week('2026-08-31', 5, 4),
    ], '2026-09-07')
    expect(result).toMatchObject({ current: 1, longest: 1 })
  })

  it('counts a run that crosses a year boundary', () => {
    const result = computeWeekStreak([
      week('2025-12-22', 3, 3),
      week('2025-12-29', 3, 2),
      week('2026-01-05', 3, 2),
    ], '2026-01-05')
    expect(result).toMatchObject({ current: 3, longest: 3 })
  })

  it('orders the weeks before walking them', () => {
    const result = computeWeekStreak([
      week('2026-08-31', 3, 3),
      week('2026-08-17', 3, 0),
      week('2026-08-24', 3, 2),
    ], '2026-09-07')
    expect(result).toMatchObject({ current: 2, longest: 2 })
  })
})

describe('buildStreakWeeks', () => {
  it('spans from the earliest trained week to the current week, resolving each week\'s block', () => {
    const weeks = buildStreakWeeks({
      schedules: [
        { id: 1, startDate: '2026-08-01', endDate: '2026-08-26', trainingDays: 3 },
        { id: 2, startDate: '2026-08-27', endDate: null, trainingDays: 5 },
      ],
      completedDaysByWeek: { '2026-08-17': 3, '2026-08-31': 4 },
      currentWeekStart: '2026-09-07',
    })
    expect(weeks).toEqual([
      { weekStart: '2026-08-17', scheduled: 3, completed: 3 },
      // Monday 2026-08-24 is covered by the first block
      { weekStart: '2026-08-24', scheduled: 3, completed: 0 },
      { weekStart: '2026-08-31', scheduled: 5, completed: 4 },
      { weekStart: '2026-09-07', scheduled: 5, completed: 0 },
    ])
  })

  // A split replaced on its own start date leaves the retired block covering that day too. The
  // live block must win, or the week is measured against a husk -- on a Monday swap, that husk is
  // exactly the week's own start.
  it('resolves an overlap on a tied start date to the newer block', () => {
    expect(buildStreakWeeks({
      schedules: [
        { id: 1, startDate: '2026-09-07', endDate: '2026-09-07', trainingDays: 1 },
        { id: 2, startDate: '2026-09-07', endDate: null, trainingDays: 3 },
      ],
      completedDaysByWeek: { '2026-09-07': 2 },
      currentWeekStart: '2026-09-07',
    })).toEqual([{ weekStart: '2026-09-07', scheduled: 3, completed: 2 }])
  })

  // Order from the query must not decide it either.
  it('resolves a tied start date the same way whatever order the schedules arrive in', () => {
    const schedules = [
      { id: 2, startDate: '2026-09-07', endDate: null, trainingDays: 3 },
      { id: 1, startDate: '2026-09-07', endDate: '2026-09-07', trainingDays: 1 },
    ]
    expect(buildStreakWeeks({ schedules, completedDaysByWeek: { '2026-09-07': 2 }, currentWeekStart: '2026-09-07' }))
      .toEqual([{ weekStart: '2026-09-07', scheduled: 3, completed: 2 }])
  })

  it('falls back to the block active on Sunday when none was active Monday', () => {
    const weeks = buildStreakWeeks({
      schedules: [{ id: 3, startDate: '2026-09-03', endDate: null, trainingDays: 4 }],
      completedDaysByWeek: { '2026-08-31': 2 },
      currentWeekStart: '2026-08-31',
    })
    expect(weeks).toEqual([{ weekStart: '2026-08-31', scheduled: 4, completed: 2 }])
  })

  it('keeps the Monday block for a week whose block ends mid-week', () => {
    const weeks = buildStreakWeeks({
      schedules: [{ id: 4, startDate: '2026-08-10', endDate: '2026-09-02', trainingDays: 3 }],
      completedDaysByWeek: { '2026-08-31': 3 },
      currentWeekStart: '2026-09-07',
    })
    expect(weeks).toEqual([
      { weekStart: '2026-08-31', scheduled: 3, completed: 3 },
      { weekStart: '2026-09-07', scheduled: 0, completed: 0 },
    ])
  })

  it('marks weeks with no block as neutral', () => {
    const weeks = buildStreakWeeks({ schedules: [], completedDaysByWeek: { '2026-08-31': 2 }, currentWeekStart: '2026-09-07' })
    expect(weeks.every(w => w.scheduled === 0)).toBe(true)
  })

  it('crosses a year boundary', () => {
    const weeks = buildStreakWeeks({ schedules: [], completedDaysByWeek: { '2025-12-22': 1 }, currentWeekStart: '2026-01-05' })
    expect(weeks.map(w => w.weekStart)).toEqual(['2025-12-22', '2025-12-29', '2026-01-05'])
  })

  it('returns nothing for a user who has never trained', () => {
    expect(buildStreakWeeks({
      schedules: [{ id: 5, startDate: '2026-08-01', endDate: null, trainingDays: 4 }],
      completedDaysByWeek: {},
      currentWeekStart: '2026-09-07',
    })).toEqual([])
  })
})
