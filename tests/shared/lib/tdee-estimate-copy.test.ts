import { describe, expect, it } from 'vitest'
import { estimateTdee } from '~~/shared/lib/adaptive-tdee'
import {
  describeTdeeEstimate,
  describeTdeeEstimateForProfile,
  describeTdeeMissing,
  formatWeightTrend,
} from '~~/shared/lib/tdee-estimate-copy'

const PREFIX = 'To estimate your maintenance calories from your own logs, '

const ready = (overrides: Partial<Parameters<typeof describeTdeeEstimate>[0]> = {}) => ({
  estimate: 2450,
  formulaTdee: 2600 as number | null,
  confidence: 1,
  bounded: false,
  ...overrides,
})

describe('describeTdeeMissing', () => {
  it('returns null when nothing is missing', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 0, weighInSpanDays: 0 })).toBeNull()
  })

  it('describes only missing logged days', () => {
    expect(describeTdeeMissing({ loggedDays: 6, weighIns: 0, weighInSpanDays: 0 }))
      .toBe(`${PREFIX}log a full day of eating on 6 more days.`)
  })

  it('uses the singular for one missing logged day', () => {
    expect(describeTdeeMissing({ loggedDays: 1, weighIns: 0, weighInSpanDays: 0 }))
      .toBe(`${PREFIX}log a full day of eating on 1 more day.`)
  })

  it('describes only missing weigh-ins', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 2, weighInSpanDays: 0 }))
      .toBe(`${PREFIX}weigh in on 2 more days.`)
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 1, weighInSpanDays: 0 }))
      .toBe(`${PREFIX}weigh in once more.`)
  })

  it('describes only a short weigh-in span without promising a date', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 0, weighInSpanDays: 1 }))
      .toBe(`${PREFIX}keep weighing in over the coming days.`)
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 0, weighInSpanDays: 6 }))
      .toBe(`${PREFIX}keep weighing in over the coming days.`)
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 0, weighInSpanDays: 7 }))
      .toBe(`${PREFIX}keep weighing in over the coming weeks.`)
  })

  it('leaves the span out when the missing weigh-ins will cover it anyway', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 1, weighInSpanDays: 1 }))
      .toBe(`${PREFIX}weigh in once more.`)
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 3, weighInSpanDays: 3 }))
      .toBe(`${PREFIX}weigh in on 3 more days.`)
  })

  it('asks for one later weigh-in when a single weigh-in must also stretch the span', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 1, weighInSpanDays: 2 }))
      .toBe(`${PREFIX}weigh in once more in a few days.`)
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 1, weighInSpanDays: 9 }))
      .toBe(`${PREFIX}weigh in once more in a few days.`)
  })

  it('spreads several weigh-ins without naming the exact span', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 2, weighInSpanDays: 3 }))
      .toBe(`${PREFIX}weigh in on 2 more days, spread over the coming days.`)
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 3, weighInSpanDays: 10 }))
      .toBe(`${PREFIX}weigh in on 3 more days, spread over the coming weeks.`)
  })

  it('joins logged days with weigh-ins', () => {
    expect(describeTdeeMissing({ loggedDays: 4, weighIns: 2, weighInSpanDays: 0 }))
      .toBe(`${PREFIX}log a full day of eating on 4 more days and weigh in on 2 more days.`)
  })

  it('joins logged days with a short span', () => {
    expect(describeTdeeMissing({ loggedDays: 4, weighIns: 0, weighInSpanDays: 3 }))
      .toBe(`${PREFIX}log a full day of eating on 4 more days and keep weighing in over the coming days.`)
  })

  it('covers a brand-new user with a profile estimate, using the real thresholds', () => {
    const result = estimateTdee({ dailyIntake: [], weighIns: [], formulaTdee: 2500, calorieTarget: null })
    if (result.status !== 'insufficient') throw new Error('expected insufficient')
    expect(describeTdeeMissing(result.missing))
      .toBe(`${PREFIX}log a full day of eating on 10 more days and weigh in on 4 more days, spread over the coming weeks.`)
  })

  it('covers a brand-new user without a profile estimate, using the stricter thresholds', () => {
    const result = estimateTdee({ dailyIntake: [], weighIns: [], formulaTdee: null, calorieTarget: null })
    if (result.status !== 'insufficient') throw new Error('expected insufficient')
    expect(describeTdeeMissing(result.missing))
      .toBe(`${PREFIX}log a full day of eating on 21 more days and weigh in on 4 more days, spread over the coming weeks.`)
  })
})

describe('describeTdeeEstimate', () => {
  it('credits the logs when confidence is full and the estimate is unbounded', () => {
    expect(describeTdeeEstimate(ready()))
      .toBe('Your intake and weight suggest maintenance is about 2,450 cal (your profile estimate is 2,600).')
  })

  it('omits the profile comparison when there is no profile estimate', () => {
    expect(describeTdeeEstimate(ready({ formulaTdee: null })))
      .toBe('Your intake and weight suggest maintenance is about 2,450 cal.')
  })

  it('says the number is blended when confidence is below full', () => {
    expect(describeTdeeEstimate(ready({ confidence: 0.6 })))
      .toBe('Blending your logs with your profile estimate, maintenance is about 2,450 cal. This sharpens as you log more.')
  })

  it('says the number is capped when bounded, even at partial confidence', () => {
    expect(describeTdeeEstimate(ready({ bounded: true })))
      .toBe('Your logs point further from your profile estimate than we\'ll trust yet, so we\'ve capped this at 2,450 cal.')
    expect(describeTdeeEstimate(ready({ bounded: true, confidence: 0.5 })))
      .toBe('Your logs point further from your profile estimate than we\'ll trust yet, so we\'ve capped this at 2,450 cal.')
  })

  it('does not mention a profile estimate when capped without one', () => {
    expect(describeTdeeEstimate(ready({ bounded: true, formulaTdee: null })))
      .toBe('Your logs point to an unusual number, so we\'ve capped this at 2,450 cal.')
  })
})

describe('describeTdeeEstimateForProfile', () => {
  it('states the number plainly at full confidence', () => {
    expect(describeTdeeEstimateForProfile(ready())).toBe('Your logs put maintenance at about 2,450 cal.')
  })

  it('marks blended and capped numbers as early estimates', () => {
    expect(describeTdeeEstimateForProfile(ready({ confidence: 0.4 })))
      .toBe('Your logs put maintenance at about 2,450 cal (early estimate).')
    expect(describeTdeeEstimateForProfile(ready({ bounded: true })))
      .toBe('Your logs put maintenance at about 2,450 cal (early estimate).')
  })
})

describe('formatWeightTrend', () => {
  it('formats kilograms with a sign', () => {
    expect(formatWeightTrend(0.25, 'metric')).toBe('+0.25 kg/week')
    expect(formatWeightTrend(-0.4, 'metric')).toBe('−0.4 kg/week')
    expect(formatWeightTrend(0, 'metric')).toBe('±0 kg/week')
  })

  it('converts to pounds at 0.1 precision for imperial users', () => {
    expect(formatWeightTrend(0.25, 'imperial')).toBe('+0.6 lb/week')
    expect(formatWeightTrend(-0.4, 'imperial')).toBe('−0.9 lb/week')
  })

  it('shows a tiny trend that rounds to zero as ±0', () => {
    expect(formatWeightTrend(0.02, 'imperial')).toBe('±0 lb/week')
  })
})
