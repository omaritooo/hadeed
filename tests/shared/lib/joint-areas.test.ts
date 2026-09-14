import { describe, expect, it } from 'vitest'
import { conflictingAreas, describeLimitationReason, firstCleanCandidate, formatAreaList, isJointArea, isJointAreaList, isLimitationReason } from '~~/shared/lib/joint-areas'

describe('isJointArea', () => {
  it('accepts known areas and rejects everything else', () => {
    expect(isJointArea('knee')).toBe(true)
    expect(isJointArea('hip')).toBe(false)
    expect(isJointArea(42)).toBe(false)
    expect(isJointArea(null)).toBe(false)
  })
})

describe('isJointAreaList', () => {
  it('accepts arrays of known areas, including an empty one', () => {
    expect(isJointAreaList(['knee', 'wrist'])).toBe(true)
    expect(isJointAreaList([])).toBe(true)
  })

  it('rejects non-arrays and arrays with any unknown area', () => {
    expect(isJointAreaList(['knee', 'hip'])).toBe(false)
    expect(isJointAreaList('knee')).toBe(false)
    expect(isJointAreaList(null)).toBe(false)
    expect(isJointAreaList(undefined)).toBe(false)
  })
})

describe('conflictingAreas', () => {
  it('returns the shared areas in canonical order regardless of input order', () => {
    expect(conflictingAreas(['ankle', 'wrist', 'knee'], ['knee', 'elbow', 'ankle'])).toEqual(['knee', 'ankle'])
    expect(conflictingAreas(['knee', 'ankle'], ['ankle', 'knee'])).toEqual(['knee', 'ankle'])
  })

  it('returns nothing when no areas overlap', () => {
    expect(conflictingAreas(['shoulder'], ['knee'])).toEqual([])
  })
})

describe('firstCleanCandidate', () => {
  it('skips candidates that stress a flagged area, keeping list order', () => {
    const candidates = [
      { id: 'a', stressors: ['shoulder', 'elbow'] as const },
      { id: 'b', stressors: ['knee'] as const },
      { id: 'c', stressors: [] as const },
    ]
    expect(firstCleanCandidate(candidates, ['shoulder'])?.id).toBe('b')
    expect(firstCleanCandidate(candidates, ['shoulder', 'knee'])?.id).toBe('c')
  })

  it('treats a candidate without stressors as clean', () => {
    expect(firstCleanCandidate([{ id: 'old' }], ['knee'])?.id).toBe('old')
  })

  it('skips excluded ids, even when they are clean', () => {
    const candidates = [
      { id: 'a', stressors: [] as const },
      { id: 'b', stressors: ['knee'] as const },
      { id: 'c', stressors: [] as const },
    ]
    expect(firstCleanCandidate(candidates, ['knee'], new Set(['a']))?.id).toBe('c')
    expect(firstCleanCandidate(candidates, ['knee'], new Set(['a', 'c']))).toBeUndefined()
  })

  it('returns the first non-excluded candidate when there are no limitations', () => {
    const candidates = [
      { id: 'a', stressors: ['knee'] as const },
      { id: 'b', stressors: ['shoulder'] as const },
    ]
    expect(firstCleanCandidate(candidates, [])?.id).toBe('a')
    expect(firstCleanCandidate(candidates, [], new Set(['a']))?.id).toBe('b')
  })

  it('returns undefined when every candidate conflicts', () => {
    expect(firstCleanCandidate([{ id: 'a', stressors: ['wrist'] as const }], ['wrist'])).toBeUndefined()
    expect(firstCleanCandidate([], ['wrist'])).toBeUndefined()
  })
})

describe('formatAreaList', () => {
  it('joins lower-cased labels as an English series, in the order given', () => {
    expect(formatAreaList(['shoulder'])).toBe('shoulder')
    expect(formatAreaList(['knee', 'lower_back'])).toBe('knee and lower back')
    expect(formatAreaList(['knee', 'shoulder', 'wrist'])).toBe('knee, shoulder, and wrist')
    expect(formatAreaList([])).toBe('')
  })
})

describe('describeLimitationReason / isLimitationReason', () => {
  it('pluralises by count', () => {
    expect(describeLimitationReason(1, ['shoulder'])).toBe('1 exercise loads your shoulder')
    expect(describeLimitationReason(3, ['knee', 'shoulder'])).toBe('3 exercises load your knee and shoulder')
  })

  it('recognises generated reasons and nothing else', () => {
    expect(isLimitationReason(describeLimitationReason(1, ['elbow']))).toBe(true)
    expect(isLimitationReason(describeLimitationReason(2, ['knee', 'ankle']))).toBe(true)
    expect(isLimitationReason('fits your 3 days/week')).toBe(false)
    expect(isLimitationReason('works with your full_gym access')).toBe(false)
  })
})
