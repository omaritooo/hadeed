import { describe, expect, it } from 'vitest'
import { inferMealType } from '~~/shared/lib/meal-type'

describe('inferMealType', () => {
  it('treats midnight through 10am as breakfast', () => {
    expect(inferMealType(0)).toBe('breakfast')
    expect(inferMealType(6)).toBe('breakfast')
    expect(inferMealType(10)).toBe('breakfast')
  })

  it('treats 11am through 2pm as lunch', () => {
    expect(inferMealType(11)).toBe('lunch')
    expect(inferMealType(13)).toBe('lunch')
    expect(inferMealType(14)).toBe('lunch')
  })

  it('treats 3pm through 8pm as dinner', () => {
    expect(inferMealType(15)).toBe('dinner')
    expect(inferMealType(18)).toBe('dinner')
    expect(inferMealType(20)).toBe('dinner')
  })

  it('treats 9pm through 11pm as snack', () => {
    expect(inferMealType(21)).toBe('snack')
    expect(inferMealType(23)).toBe('snack')
  })
})
