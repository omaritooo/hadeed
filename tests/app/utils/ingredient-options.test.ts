import { describe, expect, it } from 'vitest'
import { ingredientOptions } from '~~/app/utils/ingredient-options'
import type { Ingredient } from '~~/shared/types/nutrition.types'

const ingredient = (overrides: Partial<Ingredient>): Ingredient => ({
  id: 1,
  userId: null,
  name: 'Food',
  nameAr: null,
  category: null,
  keywords: null,
  unitType: 'weight_100g',
  unitLabel: null,
  calories: 100,
  proteinG: 1,
  carbsG: 1,
  fatG: 1,
  ...overrides,
})

describe('ingredientOptions', () => {
  it('puts the user\'s own foods first, then presets in category order', () => {
    const options = ingredientOptions([
      ingredient({ id: 1, name: 'Apple', category: 'fruit' }),
      ingredient({ id: 2, name: 'Baladi Bread', category: 'bread' }),
      ingredient({ id: 3, name: 'My Shake', userId: 'u1' }),
    ])

    expect(options.map(o => [o.value, o.group])).toEqual([
      [3, 'My foods'],
      [2, 'Bread & bakery'],
      [1, 'Fruit'],
    ])
  })

  it('makes Arabic names and alternative spellings searchable', () => {
    const [option] = ingredientOptions([ingredient({ name: 'Koshari', nameAr: 'كشري', keywords: 'koshary, kushari' })])

    expect(option!.searchText).toContain('كشري')
    expect(option!.searchText).toContain('koshary')
    expect(option!.label).toBe('Koshari')
    expect(option!.hint).toBe('كشري')
  })

  it('files a preset with no category under Other foods, after every category', () => {
    const options = ingredientOptions([
      ingredient({ id: 1, name: 'Mystery' }),
      ingredient({ id: 2, name: 'Cola', category: 'drinks' }),
    ])

    expect(options.map(o => o.group)).toEqual(['Drinks', 'Other foods'])
  })
})
