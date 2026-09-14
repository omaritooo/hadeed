// target_reps is being replaced by target_reps_min / target_reps_max in expand/contract steps
// (see server/database/migrations/rep-ranges.ts). Until the contract release, every insert
// dual-writes target_reps as the range minimum, and every read falls back to target_reps for rows
// an older app build wrote after the migration ran (see server/database/backfill-rep-ranges.ts).

export interface RepRangeInput {
  targetRepsMin?: number | null
  targetRepsMax?: number | null
}

// Column values for (target_reps, target_reps_min, target_reps_max), in that order. Older PWA
// builds still post a single targetReps to session start and block creation, so it stands in for
// whichever end of the range is missing.
export const repRangeArgs = (exercise: RepRangeInput): [number | null, number | null, number | null] => {
  const legacy = (exercise as { targetReps?: number | null }).targetReps
  const min = exercise.targetRepsMin ?? legacy ?? null
  const max = exercise.targetRepsMax ?? legacy ?? null
  return [min, min, max]
}

export const repRangeFromRow = (row: Record<string, unknown>): { targetRepsMin: number | null, targetRepsMax: number | null, targetReps: number | null } => {
  // Only a row with neither end set is a legacy row. One end set is an open-ended range the
  // range-aware app wrote on purpose, and target_reps must not fill in the other end.
  const legacyRow = row.target_reps_min == null && row.target_reps_max == null
  const legacyTarget = (row.target_reps ?? null) as number | null
  const targetRepsMin = legacyRow ? legacyTarget : (row.target_reps_min ?? null) as number | null
  const targetRepsMax = legacyRow ? legacyTarget : (row.target_reps_max ?? null) as number | null
  // TODO(Task 15): remove legacy targetReps. Older app builds read this single target from block,
  // preset and session responses.
  return { targetRepsMin, targetRepsMax, targetReps: targetRepsMin }
}
