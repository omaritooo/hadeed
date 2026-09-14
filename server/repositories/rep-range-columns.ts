// target_reps is being replaced by target_reps_min / target_reps_max in expand/contract steps
// (see server/database/migrations/rep-ranges.ts). Until the contract release, every insert
// dual-writes target_reps as the range minimum, and every read falls back to target_reps for rows
// an older app build wrote after the migration ran.

export interface RepRangeInput {
  targetRepsMin?: number | null
  targetRepsMax?: number | null
}

// Column values for (target_reps, target_reps_min, target_reps_max), in that order.
export const repRangeArgs = (exercise: RepRangeInput): [number | null, number | null, number | null] => {
  const min = exercise.targetRepsMin ?? null
  const max = exercise.targetRepsMax ?? null
  return [min, min, max]
}

export const repRangeFromRow = (row: Record<string, unknown>): { targetRepsMin: number | null, targetRepsMax: number | null } => ({
  targetRepsMin: (row.target_reps_min ?? row.target_reps ?? null) as number | null,
  targetRepsMax: (row.target_reps_max ?? row.target_reps ?? null) as number | null,
})
