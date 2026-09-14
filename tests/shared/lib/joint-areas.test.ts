import { describe, expect, it } from 'vitest'
import { conflictingAreas, isJointArea, isJointAreaList } from '~~/shared/lib/joint-areas'

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
