import { kgToLbs, round1 } from '~~/shared/lib/formulas'
import type { PrType } from '~~/shared/lib/personal-records'
import type { ProgressionSuggestion, SuggestionAction, SuggestionReason, UnitSystem } from '~~/shared/lib/progression'

// English copy keyed by reason. The Arabic/RTL work replaces this map with i18n keys of the
// same names (see docs/plans/2026-09-14-arabic-rtl-design.md).
const REASONS: Record<SuggestionReason, string> = {
  first_time: 'First time logging this — pick a weight you could do a couple more reps with.',
  missed_min_twice: 'Missed the bottom of the range two sessions running — back off and rebuild.',
  rpe_too_high: 'Last time felt much harder than prescribed — keep the weight.',
  all_sets_top_of_range: 'All sets hit the top of the range last time — add weight.',
  rpe_too_low: 'Last time felt much easier than prescribed — add weight.',
  building_reps: 'Same weight — aim for more reps than last time.',
}

const GLYPHS: Record<SuggestionAction, string> = { increase: '↑', hold: '=', reduce: '↓', first_time: '•' }

export const formatLoad = (weightKg: number, unitSystem: UnitSystem): string =>
  unitSystem === 'imperial' ? `${Math.round(kgToLbs(weightKg))}lb` : `${round1(weightKg)}kg`

const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`)

export const describeSuggestion = (suggestion: ProgressionSuggestion, unitSystem: UnitSystem) => ({
  line: suggestion.weightKg === null
    ? `Today: ${range(suggestion.repsMin, suggestion.repsMax)} reps`
    : `Today: ${formatLoad(suggestion.weightKg, unitSystem)} × ${range(suggestion.repsMin, suggestion.repsMax)}`,
  glyph: GLYPHS[suggestion.action],
  reason: REASONS[suggestion.reason],
})

const PR_LABELS: Record<PrType, string> = { weight: 'Weight', reps: 'Reps', e1rm: 'e1RM' }
const PR_ORDER: PrType[] = ['weight', 'reps', 'e1rm']

// Takes the reader's unit system rather than hardcoding kg: the pages that render this already
// show every other load in the profile's unit, and a lone kg figure beside pound figures reads
// as a different lift entirely.
export const formatPrTypes = (types: PrType[], e1rmKg: number | null, unitSystem: UnitSystem): string =>
  PR_ORDER.filter(type => types.includes(type))
    .map(type => (type === 'e1rm' && e1rmKg !== null ? `e1RM ${formatLoad(e1rmKg, unitSystem)}` : PR_LABELS[type]))
    .join(' · ')
