import { describe, expect, it } from 'vitest'
import { formatRepRange } from '~~/app/utils/format-rep-range'

describe('formatRepRange', () => {
  it('shows a dash when there is no prescription', () => {
    expect(formatRepRange(null, null)).toBe('–')
    expect(formatRepRange(undefined, undefined)).toBe('–')
  })

  it('shows a single number for a zero-width range', () => {
    expect(formatRepRange(8, 8)).toBe('8')
  })

  it('shows a range', () => {
    expect(formatRepRange(8, 10)).toBe('8–10')
  })

  it('swaps an inverted range', () => {
    expect(formatRepRange(10, 8)).toBe('8–10')
  })

  it('shows an open-ended range when only one end is set', () => {
    expect(formatRepRange(8, null)).toBe('8+')
    expect(formatRepRange(8, undefined)).toBe('8+')
    expect(formatRepRange(null, 10)).toBe('up to 10')
    expect(formatRepRange(undefined, 10)).toBe('up to 10')
  })
})
