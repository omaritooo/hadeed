import { round1 } from '~~/shared/lib/formulas'

export type PrType = 'weight' | 'reps' | 'e1rm'

export interface DetectedPr {
  type: PrType
  value: number
  previousValue: number
}

interface LoggedSet {
  weightKg: number | null
  reps: number | null
}

// Epley becomes unreliable at high reps, so sets above this never set or beat an e1RM.
export const E1RM_MAX_REPS = 12

export const estimateOneRepMax = (weightKg: number, reps: number): number => weightKg * (1 + reps / 30)

const isComplete = (s: LoggedSet): s is { weightKg: number, reps: number } =>
  s.weightKg !== null && s.reps !== null && s.reps > 0

/**
 * Compares one set against every earlier *working* set of the same exercise. No history means
 * no PR: the first session establishes the baseline rather than rewarding it.
 */
export const detectPersonalRecords = (
  set: LoggedSet & { isWarmup: boolean },
  priorWorkingSets: LoggedSet[],
): DetectedPr[] => {
  if (set.isWarmup || !isComplete(set)) return []
  const prior = priorWorkingSets.filter(isComplete)
  if (prior.length === 0) return []

  const prs: DetectedPr[] = []

  const bestWeight = Math.max(...prior.map(s => s.weightKg))
  if (set.weightKg > bestWeight) prs.push({ type: 'weight', value: set.weightKg, previousValue: bestWeight })

  const atOrAbove = prior.filter(s => s.weightKg >= set.weightKg)
  if (atOrAbove.length > 0) {
    const bestReps = Math.max(...atOrAbove.map(s => s.reps))
    if (set.reps > bestReps) prs.push({ type: 'reps', value: set.reps, previousValue: bestReps })
  }

  const eligible = prior.filter(s => s.reps <= E1RM_MAX_REPS)
  if (set.reps <= E1RM_MAX_REPS && eligible.length > 0) {
    const best = Math.max(...eligible.map(s => estimateOneRepMax(s.weightKg, s.reps)))
    const mine = estimateOneRepMax(set.weightKg, set.reps)
    if (round1(mine) > round1(best)) prs.push({ type: 'e1rm', value: round1(mine), previousValue: round1(best) })
  }

  return prs
}
