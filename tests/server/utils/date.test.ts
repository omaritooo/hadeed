import { describe, expect, it } from 'vitest'
import { dayBefore } from '~~/server/utils/date'

describe('dayBefore', () => {
  it('returns the previous calendar day as YYYY-MM-DD', () => {
    expect(dayBefore('2026-09-06')).toBe('2026-09-05')
  })

  it('rolls back across a month boundary', () => {
    expect(dayBefore('2026-09-01')).toBe('2026-08-31')
  })

  it('rolls back across a year boundary', () => {
    expect(dayBefore('2026-01-01')).toBe('2025-12-31')
  })
})
