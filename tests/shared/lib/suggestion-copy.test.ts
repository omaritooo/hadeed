import { describe, expect, it } from 'vitest'
import { describeSuggestion, formatPrTypes } from '~~/shared/lib/suggestion-copy'

describe('describeSuggestion', () => {
  it('formats an increase with its reason', () => {
    expect(describeSuggestion({ action: 'increase', reason: 'all_sets_top_of_range', weightKg: 62.5, repsMin: 8, repsMax: 10 }, 'metric')).toEqual({
      line: 'Today: 62.5kg × 8–10',
      glyph: '↑',
      reason: 'All sets hit the top of the range last time — add weight.',
    })
  })

  it('formats imperial loads in pounds', () => {
    expect(describeSuggestion({ action: 'hold', reason: 'building_reps', weightKg: 102.0582, repsMin: 8, repsMax: 10 }, 'imperial').line)
      .toBe('Today: 225lb × 8–10')
  })

  it('omits weight for bodyweight progressions', () => {
    expect(describeSuggestion({ action: 'increase', reason: 'all_sets_top_of_range', weightKg: null, repsMin: 11, repsMax: 12 }, 'metric').line)
      .toBe('Today: 11–12 reps')
  })

  it('collapses a single-value rep range', () => {
    expect(describeSuggestion({ action: 'hold', reason: 'building_reps', weightKg: 60, repsMin: 8, repsMax: 8 }, 'metric').line)
      .toBe('Today: 60kg × 8')
  })

  it('collapses a single-value rep range for bodyweight work', () => {
    expect(describeSuggestion({ action: 'hold', reason: 'building_reps', weightKg: null, repsMin: 12, repsMax: 12 }, 'metric').line)
      .toBe('Today: 12 reps')
  })

  it('glyphs and explains a hold', () => {
    expect(describeSuggestion({ action: 'hold', reason: 'rpe_too_high', weightKg: 100, repsMin: 5, repsMax: 5 }, 'metric')).toEqual({
      line: 'Today: 100kg × 5',
      glyph: '=',
      reason: 'Last time felt much harder than prescribed — keep the weight.',
    })
  })

  it('glyphs and explains a reduction', () => {
    expect(describeSuggestion({ action: 'reduce', reason: 'missed_min_twice', weightKg: 90, repsMin: 5, repsMax: 8 }, 'metric')).toEqual({
      line: 'Today: 90kg × 5–8',
      glyph: '↓',
      reason: 'Missed the bottom of the range two sessions running — back off and rebuild.',
    })
  })

  it('glyphs and explains a first-time suggestion', () => {
    expect(describeSuggestion({ action: 'first_time', reason: 'first_time', weightKg: null, repsMin: 8, repsMax: 12 }, 'metric')).toEqual({
      line: 'Today: 8–12 reps',
      glyph: '•',
      reason: 'First time logging this — pick a weight you could do a couple more reps with.',
    })
  })

  it('explains an rpe_too_low increase', () => {
    expect(describeSuggestion({ action: 'increase', reason: 'rpe_too_low', weightKg: 70, repsMin: 6, repsMax: 8 }, 'metric').reason)
      .toBe('Last time felt much easier than prescribed — add weight.')
  })
})

describe('formatPrTypes', () => {
  it('labels each type', () => {
    expect(formatPrTypes(['e1rm', 'reps', 'weight'], 116.7, 'metric')).toBe('Weight · Reps · e1RM 116.7kg')
  })

  it('labels a single weight PR', () => {
    expect(formatPrTypes(['weight'], null, 'metric')).toBe('Weight')
  })

  it('labels a single rep PR', () => {
    expect(formatPrTypes(['reps'], null, 'metric')).toBe('Reps')
  })

  it('drops the load from an e1RM PR with no value', () => {
    expect(formatPrTypes(['e1rm'], null, 'metric')).toBe('e1RM')
  })

  it('renders the e1RM load in the reader unit system', () => {
    expect(formatPrTypes(['e1rm'], 102.0582, 'imperial')).toBe('e1RM 225lb')
  })

  it('returns an empty string when nothing was set', () => {
    expect(formatPrTypes([], null, 'metric')).toBe('')
  })
})
