import { describe, expect, it } from 'vitest'
import { conflictingAreas, firstCleanCandidate, isJointArea, isJointAreaList } from '~~/shared/lib/joint-areas'

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

  it('returns undefined when every candidate conflicts', () => {
    expect(firstCleanCandidate([{ id: 'a', stressors: ['wrist'] as const }], ['wrist'])).toBeUndefined()
    expect(firstCleanCandidate([], ['wrist'])).toBeUndefined()
  })
})
