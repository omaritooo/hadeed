import { describe, expect, it } from 'vitest'
import { dayBefore, parseClientTimestamp } from '~~/server/utils/date'

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

describe('parseClientTimestamp', () => {
  it('converts an ISO string to SQLite datetime format', () => {
    expect(parseClientTimestamp('2026-09-14T10:15:30.123Z')).toBe('2026-09-14 10:15:30')
  })

  it('normalises an offset ISO string to UTC', () => {
    expect(parseClientTimestamp('2026-09-14T12:15:30+02:00')).toBe('2026-09-14 10:15:30')
  })

  it('returns null for missing or invalid input', () => {
    expect(parseClientTimestamp(undefined)).toBeNull()
    expect(parseClientTimestamp(null)).toBeNull()
    expect(parseClientTimestamp('not a date')).toBeNull()
    expect(parseClientTimestamp('')).toBeNull()
  })

  it('returns null for non-string input rather than coercing it', () => {
    expect(parseClientTimestamp(1757845530123)).toBeNull()
    expect(parseClientTimestamp(new Date())).toBeNull()
    expect(parseClientTimestamp({ loggedAt: '2026-09-14T10:15:30Z' })).toBeNull()
  })
})
