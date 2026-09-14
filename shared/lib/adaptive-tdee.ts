export type TdeeEstimate =
  | { status: 'insufficient', missing: { loggedDays: number, weighIns: number, weighInSpanDays: number } }
  | {
      status: 'ready'
      estimate: number
      observed: number
      formulaTdee: number | null
      confidence: number
      avgIntake: number
      trendKgPerWeek: number
      bounded: boolean
    }

export interface TdeeEstimateInput {
  dailyIntake: { date: string, calories: number }[]
  weighIns: { date: string, weightKg: number }[]
  formulaTdee: number | null
  calorieTarget: number | null
}

export const KCAL_PER_KG = 7700
export const WINDOW_DAYS = 28
const MIN_LOGGED_DAYS = 10
const MIN_WEIGH_INS = 4
const MIN_WEIGH_IN_SPAN_DAYS = 10
const FULL_CONFIDENCE_DAYS = 21
const INCOMPLETE_DAY_FRACTION = 0.5
// Keeps snack-only days out even when there's no target or formula to take a fraction of.
const INCOMPLETE_DAY_FLOOR_KCAL = 800
const LOWER_BOUND = 0.7
const UPPER_BOUND = 1.4
const ABSOLUTE_MIN_TDEE = 1200
const ABSOLUTE_MAX_TDEE = 5000

const MS_PER_DAY = 86_400_000
const dayNumber = (value: string) => Math.floor(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / MS_PER_DAY)

// Least squares over raw weigh-ins. The regression averages out water noise on its own; an
// EWMA in front of it was tried in design and biased a 28-day slope ~30% low from lag.
export const weightSlopeKgPerDay = (weighIns: { date: string, weightKg: number }[]): number => {
  if (weighIns.length < 2) return 0
  const points = weighIns.map(w => ({ x: dayNumber(w.date), y: w.weightKg }))
  const meanX = points.reduce((s, p) => s + p.x, 0) / points.length
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length
  const denominator = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0)
  if (denominator === 0) return 0
  return points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0) / denominator
}

export const estimateTdee = (input: TdeeEstimateInput): TdeeEstimate => {
  const { formulaTdee, calorieTarget } = input
  const incompleteBelow = Math.max(INCOMPLETE_DAY_FLOOR_KCAL, (calorieTarget ?? formulaTdee ?? 0) * INCOMPLETE_DAY_FRACTION)
  const loggedDays = input.dailyIntake.filter(d => d.calories >= incompleteBelow)

  // A bad date string would turn the span and slope into NaN, so those entries are dropped.
  const validWeighIns = input.weighIns.filter(w => Number.isFinite(dayNumber(w.date)))
  const days = validWeighIns.map(w => dayNumber(w.date))
  const spanDays = days.length === 0 ? 0 : Math.max(...days) - Math.min(...days)

  // Without a formula to blend toward, only a full-confidence window is trustworthy.
  const neededDays = formulaTdee === null ? FULL_CONFIDENCE_DAYS : MIN_LOGGED_DAYS
  const neededSpan = formulaTdee === null ? FULL_CONFIDENCE_DAYS : MIN_WEIGH_IN_SPAN_DAYS
  const missing = {
    loggedDays: Math.max(0, neededDays - loggedDays.length),
    weighIns: Math.max(0, MIN_WEIGH_INS - new Set(days).size),
    weighInSpanDays: Math.max(0, neededSpan - spanDays),
  }
  if (missing.loggedDays > 0 || missing.weighIns > 0 || missing.weighInSpanDays > 0) return { status: 'insufficient', missing }

  const avgIntake = loggedDays.reduce((s, d) => s + d.calories, 0) / loggedDays.length
  const slope = weightSlopeKgPerDay(validWeighIns)
  const observed = avgIntake - slope * KCAL_PER_KG
  const confidence = Math.min(1, loggedDays.length / FULL_CONFIDENCE_DAYS) * Math.min(1, spanDays / FULL_CONFIDENCE_DAYS)

  const blended = formulaTdee === null ? observed : confidence * observed + (1 - confidence) * formulaTdee
  const [lower, upper] = formulaTdee === null
    ? [ABSOLUTE_MIN_TDEE, ABSOLUTE_MAX_TDEE]
    : [LOWER_BOUND * formulaTdee, UPPER_BOUND * formulaTdee]
  const estimate = Math.min(upper, Math.max(lower, blended))
  const bounded = estimate !== blended

  return {
    status: 'ready',
    estimate: Math.round(estimate),
    observed: Math.round(observed),
    formulaTdee,
    confidence,
    avgIntake: Math.round(avgIntake),
    trendKgPerWeek: Math.round(slope * 7 * 100) / 100,
    bounded,
  }
}
