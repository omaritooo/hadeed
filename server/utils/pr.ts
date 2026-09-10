/**
 * A warm-up set is never a PR, no matter how heavy — it isn't a real working effort. A working
 * set only counts as a PR if it beats the best *non-warm-up* weight on record, so `previousBestKg`
 * must already come from a warm-up-excluding lookup (see `SessionRepository.findBestWeightForExercise`).
 */
export const isNewPersonalRecord = (
  setLog: { weightKg: number | null, isWarmup: boolean },
  previousBestKg: number | null,
): boolean => {
  if (setLog.isWarmup) return false
  if (setLog.weightKg === null) return false
  return previousBestKg === null || setLog.weightKg > previousBestKg
}
