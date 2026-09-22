import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { arabicPluralIndex } from '~~/shared/lib/arabic-plural'

// Message forms, in CLDR order: zero | one | two | few | many | other
describe('arabicPluralIndex', () => {
  it.each([
    [0, 0], [1, 1], [2, 2],
    [3, 3], [10, 3], [103, 3], [1003, 3],
    [11, 4], [99, 4], [111, 4], [1099, 4],
    [100, 5], [101, 5], [102, 5], [200, 5], [1000, 5],
  ])('%i -> form %i', (n, form) => {
    expect(arabicPluralIndex(n, 6)).toBe(form)
  })

  // CLDR's `n % 100 = 3..10` matches integers only, so a fractional count is "other".
  it('treats a fractional count as the other form', () => {
    expect(arabicPluralIndex(3.5, 6)).toBe(5)
    expect(arabicPluralIndex(12.5, 6)).toBe(5)
    // A whole number written as a fraction still counts as whole.
    expect(arabicPluralIndex(3.0, 6)).toBe(3)
  })

  it('reads a negative count by its magnitude', () => {
    expect(arabicPluralIndex(-1, 6)).toBe(1)
    expect(arabicPluralIndex(-11, 6)).toBe(4)
  })

  // vue-i18n indexes the form array with whatever this returns, so an index past the end
  // would render `undefined`.
  it('never returns an index past the last form', () => {
    for (let length = 1; length <= 6; length++) {
      for (const n of [0, 1, 2, 3, 11, 100, 3.5]) {
        const index = arabicPluralIndex(n, length)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThanOrEqual(length - 1)
      }
    }
  })

  // Three to five forms are read as the CLDR order truncated, which for three forms coincides
  // with vue-i18n's own zero | singular | plural convention.
  it('clamps to the last form when a message defines three to five', () => {
    expect(arabicPluralIndex(0, 3)).toBe(0)
    expect(arabicPluralIndex(1, 3)).toBe(1)
    expect(arabicPluralIndex(2, 3)).toBe(2)
    expect(arabicPluralIndex(11, 3)).toBe(2)
    expect(arabicPluralIndex(11, 5)).toBe(4)
    expect(arabicPluralIndex(100, 5)).toBe(4)
  })

  // Two forms can only be singular | plural, so the six-form index must not be clamped into
  // them -- that would render a count of one with the plural form.
  it('reads a two-form message as singular and plural', () => {
    expect(arabicPluralIndex(1, 2)).toBe(0)
    expect(arabicPluralIndex(0, 2)).toBe(1)
    expect(arabicPluralIndex(2, 2)).toBe(1)
    expect(arabicPluralIndex(5, 2)).toBe(1)
  })

  // vue-i18n calls the rule with -1 when a plural message is rendered without a count.
  it('falls back to the one form for a missing count', () => {
    expect(arabicPluralIndex(-1, 6)).toBe(1)
    expect(arabicPluralIndex(-1, 2)).toBe(0)
  })

  // The fixtures above are hand-written, so check the whole rule against the platform's own
  // CLDR data rather than only against what this test expects.
  it('matches Intl.PluralRules for every count up to 2000', () => {
    const forms = ['zero', 'one', 'two', 'few', 'many', 'other']
    const cldr = new Intl.PluralRules('ar')
    const disagreements: string[] = []
    for (let n = 0; n <= 2000; n++) {
      const expected = forms.indexOf(cldr.select(n))
      const actual = arabicPluralIndex(n, 6)
      if (actual !== expected) disagreements.push(`${n}: got ${forms[actual]}, CLDR says ${cldr.select(n)}`)
    }
    for (const n of [0.5, 1.5, 2.5, 3.5, 10.5, 11.5, 100.5]) {
      const expected = forms.indexOf(cldr.select(n))
      const actual = arabicPluralIndex(n, 6)
      if (actual !== expected) disagreements.push(`${n}: got ${forms[actual]}, CLDR says ${cldr.select(n)}`)
    }
    expect(disagreements).toEqual([])
  })
})

// The index only matters through vue-i18n, which indexes the compiled forms with it.
describe('arabicPluralIndex through vue-i18n', () => {
  const i18n = createI18n({
    legacy: false,
    locale: 'ar',
    pluralRules: { ar: arabicPluralIndex },
    messages: {
      ar: {
        sets: 'لا مجموعات | مجموعة واحدة | مجموعتان | {n} مجموعات | {n} مجموعة | {n} مجموعة',
        short: 'مجموعة | مجموعات',
      },
    },
  })

  it('renders each of the six forms', () => {
    const t = i18n.global.t
    expect([0, 1, 2, 3, 11, 100].map(n => t('sets', n))).toEqual([
      'لا مجموعات',
      'مجموعة واحدة',
      'مجموعتان',
      '3 مجموعات',
      '11 مجموعة',
      '100 مجموعة',
    ])
  })

  it('renders a two-form message as singular and plural', () => {
    const t = i18n.global.t
    expect([1, 0, 2, 5].map(n => t('short', n))).toEqual(['مجموعة', 'مجموعات', 'مجموعات', 'مجموعات'])
  })
})
