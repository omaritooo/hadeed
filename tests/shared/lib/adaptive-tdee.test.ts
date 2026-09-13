import { describe, expect, it } from 'vitest'
import { estimateTdee, weightSlopeKgPerDay } from '~~/shared/lib/adaptive-tdee'

const WINDOW_START = '2026-08-01'
const day = (offset: number) => {
  const d = new Date(`${WINDOW_START}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const intake = (days: number, calories: number, from = 0) =>
  Array.from({ length: days }, (_, i) => ({ date: day(from + i), calories }))
const weighIns = (offsets: number[], weightAt: (offset: number) => number) =>
  offsets.map(offset => ({ date: day(offset), weightKg: weightAt(offset) }))
const EVERY_OTHER_DAY = Array.from({ length: 14 }, (_, i) => i * 2) // 0..26

describe('weightSlopeKgPerDay', () => {
  it('recovers a linear trend exactly', () => {
    expect(weightSlopeKgPerDay(weighIns([0, 7, 14, 21], d => 90 - 0.1 * d))).toBeCloseTo(-0.1, 10)
  })

  it('accepts recorded_at timestamps, not just dates', () => {
    expect(weightSlopeKgPerDay([{ date: '2026-08-01T07:30:00.000Z', weightKg: 80 }, { date: '2026-08-11 07:30:00', weightKg: 81 }])).toBeCloseTo(0.1, 10)
  })

  it('returns 0 for fewer than 2 points', () => {
    expect(weightSlopeKgPerDay([])).toBe(0)
    expect(weightSlopeKgPerDay(weighIns([0], () => 80))).toBe(0)
  })

  it('returns 0 when every point is on the same day', () => {
    expect(weightSlopeKgPerDay(weighIns([3, 3, 3], d => 80 + d))).toBe(0)
  })
})

describe('estimateTdee', () => {
  it('equals average intake when weight is flat', () => {
    const result = estimateTdee({ dailyIntake: intake(28, 2500), weighIns: weighIns(EVERY_OTHER_DAY, () => 80), formulaTdee: 2300, calorieTarget: 2400 })
    expect(result).toMatchObject({ status: 'ready', estimate: 2500, observed: 2500, confidence: 1, avgIntake: 2500, trendKgPerWeek: 0, bounded: false })
  })

  it('adds the energy of a steady loss back onto intake', () => {
    // 0.5 kg/week loss on 2000 kcal/day -> 2000 + (0.5/7) * 7700 = 2550
    const result = estimateTdee({ dailyIntake: intake(28, 2000), weighIns: weighIns(EVERY_OTHER_DAY, d => 90 - (0.5 / 7) * d), formulaTdee: 2400, calorieTarget: 2000 })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.estimate).toBe(2550)
      expect(result.trendKgPerWeek).toBe(-0.5)
    }
  })

  it('stays close under day-to-day water noise', () => {
    const result = estimateTdee({
      dailyIntake: intake(28, 2000),
      weighIns: weighIns(EVERY_OTHER_DAY, d => 90 - (0.5 / 7) * d + (d % 4 === 0 ? 0.7 : -0.7)),
      formulaTdee: 2400,
      calorieTarget: 2000,
    })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(Math.abs(result.estimate - 2550)).toBeLessThanOrEqual(110)
    }
  })

  it('excludes days logged at under half the calorie target', () => {
    const result = estimateTdee({
      dailyIntake: [...intake(20, 2400), ...intake(5, 500, 20)],
      weighIns: weighIns(EVERY_OTHER_DAY, () => 80),
      formulaTdee: 2400,
      calorieTarget: 2000,
    })
    expect(result).toMatchObject({ status: 'ready', avgIntake: 2400 })
  })

  it('falls back to the formula for the incomplete-day threshold when there is no target', () => {
    // threshold = 0.5 * 2400 = 1200, so the 1000 kcal days drop out
    const result = estimateTdee({
      dailyIntake: [...intake(20, 2400), ...intake(5, 1000, 20)],
      weighIns: weighIns(EVERY_OTHER_DAY, () => 80),
      formulaTdee: 2400,
      calorieTarget: null,
    })
    expect(result).toMatchObject({ status: 'ready', avgIntake: 2400 })
  })

  it('blends toward the formula at partial confidence', () => {
    // confidence = (14/21) * (13/21) = 0.4127 -> 0.4127*2600 + 0.5873*2200 = 2365
    const result = estimateTdee({ dailyIntake: intake(14, 2600), weighIns: weighIns([0, 4, 8, 13], () => 80), formulaTdee: 2200, calorieTarget: null })
    expect(result).toMatchObject({ status: 'ready', observed: 2600, estimate: 2365 })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.confidence).toBeCloseTo(0.4127, 3)
    }
  })

  it('bounds an implausible estimate to 1.4x the formula', () => {
    const result = estimateTdee({ dailyIntake: intake(28, 4000), weighIns: weighIns(EVERY_OTHER_DAY, () => 80), formulaTdee: 2000, calorieTarget: null })
    expect(result).toMatchObject({ status: 'ready', estimate: 2800, bounded: true })
  })

  it('bounds an implausible estimate to 0.7x the formula', () => {
    const result = estimateTdee({ dailyIntake: intake(28, 1200), weighIns: weighIns(EVERY_OTHER_DAY, () => 80), formulaTdee: 2000, calorieTarget: null })
    expect(result).toMatchObject({ status: 'ready', observed: 1200, estimate: 1400, bounded: true })
  })

  it('bounds to absolute limits when there is no formula', () => {
    // gaining 0.1 kg/day on 1500 kcal -> observed 1500 - 770 = 730
    const result = estimateTdee({ dailyIntake: intake(28, 1500), weighIns: weighIns(EVERY_OTHER_DAY, d => 80 + 0.1 * d), formulaTdee: null, calorieTarget: null })
    expect(result).toMatchObject({ status: 'ready', observed: 730, estimate: 1200, bounded: true })
  })

  it('reports what is missing below the thresholds', () => {
    const result = estimateTdee({ dailyIntake: intake(9, 2000), weighIns: weighIns([0, 2, 4], () => 80), formulaTdee: 2200, calorieTarget: null })
    expect(result).toEqual({ status: 'insufficient', missing: { loggedDays: 1, weighIns: 1, weighInSpanDays: 6 } })
  })

  it('counts distinct weigh-in days, not raw entries', () => {
    const result = estimateTdee({ dailyIntake: intake(28, 2000), weighIns: weighIns([0, 0, 0, 21], () => 80), formulaTdee: 2200, calorieTarget: null })
    expect(result).toEqual({ status: 'insufficient', missing: { loggedDays: 0, weighIns: 2, weighInSpanDays: 0 } })
  })

  it('ignores weigh-ins with an unparseable date', () => {
    const result = estimateTdee({
      dailyIntake: intake(28, 2500),
      weighIns: [...weighIns(EVERY_OTHER_DAY, () => 80), { date: 'not-a-date', weightKg: 999 }],
      formulaTdee: 2300,
      calorieTarget: null,
    })
    expect(result).toMatchObject({ status: 'ready', estimate: 2500, trendKgPerWeek: 0, bounded: false })
  })

  it('requires full confidence when there is no formula TDEE', () => {
    const partial = estimateTdee({ dailyIntake: intake(14, 2600), weighIns: weighIns([0, 4, 8, 13], () => 80), formulaTdee: null, calorieTarget: null })
    expect(partial).toEqual({ status: 'insufficient', missing: { loggedDays: 7, weighIns: 0, weighInSpanDays: 8 } })

    const full = estimateTdee({ dailyIntake: intake(28, 2600), weighIns: weighIns(EVERY_OTHER_DAY, () => 80), formulaTdee: null, calorieTarget: null })
    expect(full).toMatchObject({ status: 'ready', estimate: 2600, bounded: false })
  })
})
