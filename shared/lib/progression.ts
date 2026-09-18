import { kgToLbs, lbsToKg } from '~~/shared/lib/formulas'
import type { SetType } from '~~/shared/types/split.types'

export type SuggestionAction = 'increase' | 'hold' | 'reduce' | 'first_time'
export type SuggestionReason =
  | 'first_time'
  | 'missed_min_twice'
  | 'rpe_too_high'
  | 'all_sets_top_of_range'
  | 'rpe_too_low'
  | 'building_reps'
export type UnitSystem = 'metric' | 'imperial'

export interface WorkingSet {
  weightKg: number | null
  reps: number | null
  rpe: number | null
}

export interface ProgressionInput {
  prescription: { sets: number | null, repsMin: number | null, repsMax: number | null, rpe: number | null }
  // Working (non-warm-up) sets of the most recent completed sessions containing this exercise,
  // newest session first.
  recentSessions: WorkingSet[][]
  setType: SetType
  equipment: string | null
  movementPattern: string | null
  unitSystem: UnitSystem
}

export interface ProgressionSuggestion {
  action: SuggestionAction
  reason: SuggestionReason
  weightKg: number | null
  repsMin: number
  repsMax: number
}

const LOWER_BODY_PATTERNS = new Set(['knee_dominant', 'hip_dominant'])
const RPE_TOO_HIGH_MARGIN = 1.5
const RPE_INCREASE_TOLERANCE = 0.5
const RPE_TOO_LOW_MARGIN = 2
const REDUCE_FACTOR = 0.9

// The smallest sensible jump, in the user's own unit.
export const loadIncrement = (equipment: string | null, movementPattern: string | null, unitSystem: UnitSystem): number => {
  const metric = unitSystem === 'metric'
  if (equipment === 'barbell' && movementPattern !== null && LOWER_BODY_PATTERNS.has(movementPattern)) return metric ? 5 : 10
  if (equipment === 'dumbbell') return metric ? 2 : 5
  return metric ? 2.5 : 5
}

const toUnit = (kg: number, unitSystem: UnitSystem) => (unitSystem === 'metric' ? kg : kgToLbs(kg))
const fromUnit = (value: number, unitSystem: UnitSystem) => (unitSystem === 'metric' ? value : lbsToKg(value))
const snap = (value: number, increment: number) => Math.round(value / increment) * increment

// The weight at or above which at least half the working sets were done (an upper median), so
// one heavy top single or a ramp-up set doesn't define it.
export const workingWeight = (sets: WorkingSet[]): number | null => {
  const weights = sets
    .map(s => s.weightKg)
    .filter((w): w is number => w !== null)
    .sort((a, b) => b - a)
  if (weights.length === 0) return null
  return weights[Math.ceil(weights.length / 2) - 1]!
}

const averageRpe = (sets: WorkingSet[]): number | null => {
  const rpes = sets.map(s => s.rpe).filter((r): r is number => r !== null)
  if (rpes.length === 0) return null
  return rpes.reduce((sum, r) => sum + r, 0) / rpes.length
}

const countReaching = (sets: WorkingSet[], reps: number) => sets.filter(s => s.reps !== null && s.reps >= reps).length
const missedMin = (sets: WorkingSet[] | undefined, repsMin: number) =>
  sets !== undefined && sets.some(s => s.reps !== null && s.reps < repsMin)

/**
 * Double progression with RPE autoregulation. Rules are checked in order and the first match
 * wins -- see docs/plans/2026-09-14-progression-and-prs-design.md for the reasoning behind
 * each threshold. Returns null when there's nothing to progress (time-based work, or a
 * prescription with no rep range).
 */
export const suggestProgression = (input: ProgressionInput): ProgressionSuggestion | null => {
  const { prescription, recentSessions, setType, unitSystem } = input
  const { repsMin, repsMax } = prescription
  if (setType === 'time' || repsMin === null || repsMax === null) return null

  const last = recentSessions[0] ?? []
  if (last.length === 0) return { action: 'first_time', reason: 'first_time', weightKg: null, repsMin, repsMax }

  const current = setType === 'weight_reps' ? workingWeight(last) : null
  const increment = loadIncrement(input.equipment, input.movementPattern, unitSystem)

  const hold = (reason: SuggestionReason): ProgressionSuggestion =>
    ({ action: 'hold', reason, weightKg: current, repsMin, repsMax })

  const increase = (reason: SuggestionReason): ProgressionSuggestion => {
    if (current === null) return { action: 'increase', reason, weightKg: null, repsMin: repsMax + 1, repsMax: repsMax + 2 }
    const next = snap(toUnit(current, unitSystem), increment) + increment
    return { action: 'increase', reason, weightKg: fromUnit(next, unitSystem), repsMin, repsMax }
  }

  // 1. Missed the bottom of the range two sessions running -> back off (loadable work only).
  if (missedMin(recentSessions[0], repsMin) && missedMin(recentSessions[1], repsMin)) {
    if (current === null) return hold('missed_min_twice')
    const reduced = snap(toUnit(current, unitSystem) * REDUCE_FACTOR, increment)
    return { action: 'reduce', reason: 'missed_min_twice', weightKg: fromUnit(reduced, unitSystem), repsMin, repsMax }
  }

  const avgRpe = averageRpe(last)
  const targetRpe = prescription.rpe
  const rpeKnown = avgRpe !== null && targetRpe !== null

  // 2. Grinding well above the prescribed effort -> don't add load.
  if (rpeKnown && avgRpe >= targetRpe + RPE_TOO_HIGH_MARGIN) return hold('rpe_too_high')

  const setsRequired = prescription.sets ?? last.length

  // 3. Every prescribed set reached the top of the range at a sane effort.
  if (countReaching(last, repsMax) >= setsRequired && (!rpeKnown || avgRpe <= targetRpe + RPE_INCREASE_TOLERANCE)) {
    return increase('all_sets_top_of_range')
  }

  // 4. Far easier than prescribed, and at least in the range on every set.
  if (rpeKnown && avgRpe <= targetRpe - RPE_TOO_LOW_MARGIN && countReaching(last, repsMin) >= setsRequired) {
    return increase('rpe_too_low')
  }

  return hold('building_reps')
}

/**
 * What to pre-fill into a working set's inputs, given the suggestion for this exercise and
 * whatever the page's own history logic came up with (last session's matching set, or the set
 * just logged). A fill, not a lock -- the lifter types over it freely.
 *
 * Only a changed load overrides history, and only on the first working set: the suggestion is
 * advice about where to start the exercise, so once a working set has actually been logged today
 * the lifter's own choice is the better fill. Re-asserting the suggestion on set two would retype
 * over the weight they just decided on -- if they went to 65 after a suggested 62.5, they meant
 * it. Warm-ups don't count as starting, so a warm-up first still leaves the suggestion standing.
 */
export const prefillForSet = (
  suggestion: ProgressionSuggestion | null,
  fallback: { weightKg: number | null, reps: number | null } | null,
  isFirstWorkingSet: boolean,
): { weightKg: number | null, reps: number | null } | null => {
  if (!isFirstWorkingSet) return fallback
  if (suggestion === null || (suggestion.action !== 'increase' && suggestion.action !== 'reduce')) return fallback
  // Bodyweight and time set types carry no suggested load, so only the reps move.
  return { weightKg: suggestion.weightKg ?? fallback?.weightKg ?? null, reps: suggestion.repsMin }
}
