import { arabicPluralIndex } from '~~/shared/lib/arabic-plural'

// CLDR made `latn` the default numbering system for the bare `ar` locale, so Arabic-Indic digits
// (٠١٢٣) only appear when `numberingSystem` asks for them -- `Intl.NumberFormat('ar')` alone
// still renders 1234. Everything the app prints through `$n()` therefore names a format here.
const numberFormats = (numberingSystem: 'latn' | 'arab') => ({
  // Reps, sets, calories, steps: whole numbers.
  integer: { maximumFractionDigits: 0, numberingSystem },
  // Weights and macros, which are shown to one decimal (82.5 kg).
  decimal: { maximumFractionDigits: 1, numberingSystem },
  // Takes a fraction: 0.75 -> 75%.
  percent: { style: 'percent', maximumFractionDigits: 0, numberingSystem },
}) as const

// The Gregorian calendar is deliberate (Hijri display is out of scope); `ar` resolves to it by
// default, so only the digits need saying.
const datetimeFormats = (numberingSystem: 'latn' | 'arab') => ({
  short: { day: 'numeric', month: 'short', numberingSystem },
  long: { day: 'numeric', month: 'short', year: 'numeric', numberingSystem },
}) as const

export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'en',
  // Arabic has six plural forms against English's two, so it needs a rule of its own; without it
  // vue-i18n picks with the singular/plural default and "3 sets" comes out wrong.
  pluralRules: { ar: arabicPluralIndex },
  numberFormats: { en: numberFormats('latn'), ar: numberFormats('arab') },
  datetimeFormats: { en: datetimeFormats('latn'), ar: datetimeFormats('arab') },
}))
