import { describe, expect, it } from 'vitest'
import { describeTdeeMissing } from '~~/shared/lib/tdee-estimate-copy'

const PREFIX = 'To estimate your TDEE from your own data, '

describe('describeTdeeMissing', () => {
  it('returns null when nothing is missing', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 0, weighInSpanDays: 0 })).toBeNull()
  })

  it('describes only missing meal days', () => {
    expect(describeTdeeMissing({ loggedDays: 6, weighIns: 0, weighInSpanDays: 0 }))
      .toBe(`${PREFIX}log meals on 6 more days.`)
  })

  it('uses the singular for one missing meal day', () => {
    expect(describeTdeeMissing({ loggedDays: 1, weighIns: 0, weighInSpanDays: 0 }))
      .toBe(`${PREFIX}log meals on 1 more day.`)
  })

  it('describes only missing weigh-ins', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 2, weighInSpanDays: 0 }))
      .toBe(`${PREFIX}weigh in on 2 more days.`)
  })

  it('describes only a short weigh-in span', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 0, weighInSpanDays: 5 }))
      .toBe(`${PREFIX}keep weighing in for 5 more days.`)
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 0, weighInSpanDays: 1 }))
      .toBe(`${PREFIX}keep weighing in for 1 more day.`)
  })

  it('leaves the span out when the missing weigh-ins will cover it anyway', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 1, weighInSpanDays: 1 }))
      .toBe(`${PREFIX}weigh in once more.`)
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 3, weighInSpanDays: 2 }))
      .toBe(`${PREFIX}weigh in on 3 more days.`)
  })

  it('folds a longer span into the weigh-in clause when both are missing', () => {
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 1, weighInSpanDays: 5 }))
      .toBe(`${PREFIX}weigh in once more, at least 5 days from now.`)
    expect(describeTdeeMissing({ loggedDays: 0, weighIns: 3, weighInSpanDays: 10 }))
      .toBe(`${PREFIX}weigh in on 3 more days, spread across the next 10 days.`)
  })

  it('joins meal days with weigh-ins', () => {
    expect(describeTdeeMissing({ loggedDays: 4, weighIns: 2, weighInSpanDays: 0 }))
      .toBe(`${PREFIX}log meals on 4 more days and weigh in on 2 more days.`)
  })

  it('joins meal days with a short span', () => {
    expect(describeTdeeMissing({ loggedDays: 4, weighIns: 0, weighInSpanDays: 3 }))
      .toBe(`${PREFIX}log meals on 4 more days and keep weighing in for 3 more days.`)
  })

  it('covers a brand-new user missing everything', () => {
    expect(describeTdeeMissing({ loggedDays: 10, weighIns: 3, weighInSpanDays: 10 }))
      .toBe(`${PREFIX}log meals on 10 more days and weigh in on 3 more days, spread across the next 10 days.`)
  })
})
