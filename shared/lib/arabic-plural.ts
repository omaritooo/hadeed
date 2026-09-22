// vue-i18n picks a plural form by indexing the message's `|`-separated forms with whatever this
// returns, so the six CLDR categories for Arabic map to indexes in their CLDR order:
//
//   zero (0) | one (1) | two (2) | few (n % 100 = 3..10) | many (n % 100 = 11..99) | other
//
// "other" is what's left: 100, 101, 102, 1000, and any fractional count. CLDR's ranges match
// whole numbers only, so 3.5 is "other" even though 3.5 % 100 falls inside 3..10.
//
// The index is always clamped into the forms the message actually defines -- vue-i18n does no
// bounds check of its own, and an index past the end renders as `undefined`.
export const arabicPluralIndex = (choice: number, choicesLength: number): number => {
  const n = Math.abs(choice)

  // Two forms can only have been written singular | plural: clamping the six-form index into
  // them would render a count of one with the plural form. Three to five forms are read as the
  // CLDR order truncated, which for three forms is also vue-i18n's zero | singular | plural.
  if (choicesLength <= 2) return choicesLength <= 1 ? 0 : n === 1 ? 0 : 1

  const whole = Number.isInteger(n)
  const mod100 = n % 100
  const index = n === 0
    ? 0
    : n === 1
      ? 1
      : n === 2
        ? 2
        : whole && mod100 >= 3 && mod100 <= 10
          ? 3
          : whole && mod100 >= 11 && mod100 <= 99
            ? 4
            : 5

  return Math.min(index, choicesLength - 1)
}
