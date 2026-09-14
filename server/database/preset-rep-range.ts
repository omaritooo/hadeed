// Preset prescriptions are authored as a single rep target and widened into a range, so double
// progression has room to work. Targets up to 10 get a 2-rep window, 11 to 15 get 3, and anything
// higher gets 5. The seed applies this to new presets and the rep-ranges migration applies the SQL
// form to presets already in the database, so both are built from these constants.
const LOW_REP_CEILING = 10
const LOW_REP_WINDOW = 2
const MID_REP_CEILING = 15
const MID_REP_WINDOW = 3
const HIGH_REP_WINDOW = 5

export interface PresetRepRange {
  targetRepsMin: number | null
  targetRepsMax: number | null
}

export const presetRepRange = (target: number | null): PresetRepRange => {
  if (target === null) return { targetRepsMin: null, targetRepsMax: null }
  if (target <= LOW_REP_CEILING) return { targetRepsMin: target, targetRepsMax: target + LOW_REP_WINDOW }
  if (target <= MID_REP_CEILING) return { targetRepsMin: target, targetRepsMax: target + MID_REP_WINDOW }
  return { targetRepsMin: target, targetRepsMax: target + HIGH_REP_WINDOW }
}

// Column names the SQL form may be built over. The name is interpolated into SQL, so it's a closed
// set rather than an arbitrary string.
export type PresetRepRangeColumn = 'target_reps'

// SQL equivalent of presetRepRange(column).targetRepsMax.
export const presetRepRangeMaxSql = (column: PresetRepRangeColumn): string =>
  `CASE WHEN ${column} IS NULL THEN NULL`
  + ` WHEN ${column} <= ${LOW_REP_CEILING} THEN ${column} + ${LOW_REP_WINDOW}`
  + ` WHEN ${column} <= ${MID_REP_CEILING} THEN ${column} + ${MID_REP_WINDOW}`
  + ` ELSE ${column} + ${HIGH_REP_WINDOW} END`
