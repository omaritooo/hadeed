import type { TdeeEstimate } from '~~/shared/lib/adaptive-tdee'
import type { UnitSystem } from '~~/shared/types/profile.types'
import { kgToLbs } from '~~/shared/lib/formulas'

export type TdeeMissing = Extract<TdeeEstimate, { status: 'insufficient' }>['missing']
export type TdeeReady = Pick<Extract<TdeeEstimate, { status: 'ready' }>, 'estimate' | 'formulaTdee' | 'confidence' | 'bounded'>

// Fixed locale so server render, client hydration and tests all agree on "2,450".
const numberFormat = new Intl.NumberFormat('en-US')
const cal = (value: number) => `${numberFormat.format(Math.round(value))} cal`

const plural = (count: number, singular: string) => `${count} ${singular}${count === 1 ? '' : 's'}`

// The span shortfall only says the weigh-ins need to be further apart; the exact number of
// days depends on when the last one was, so the copy stays vague rather than promise a date.
const comingPeriod = (spanDays: number) => (spanDays >= 7 ? 'the coming weeks' : 'the coming days')

// One sentence telling the user what's left before maintenance can come from their own logs.
// Every combination of shortfalls gets its own grammatical phrasing; null when nothing is
// missing, so callers can hide the line rather than render an empty instruction.
export const describeTdeeMissing = (missing: TdeeMissing): string | null => {
  const { loggedDays, weighIns, weighInSpanDays } = missing
  const clauses: string[] = []

  if (loggedDays > 0) clauses.push(`log a full day of eating on ${plural(loggedDays, 'more day')}`)

  // Weigh-ins count once per calendar day, so "on N more days" is the accurate unit. Weighing
  // in on N new days going forward already stretches the span by at least N days, so the span
  // is only mentioned when it needs more than that.
  if (weighIns === 1 && weighInSpanDays > 1) {
    clauses.push('weigh in once more in a few days')
  }
  else if (weighIns > 1 && weighInSpanDays > weighIns) {
    clauses.push(`weigh in on ${weighIns} more days, spread over ${comingPeriod(weighInSpanDays)}`)
  }
  else if (weighIns > 0) {
    clauses.push(weighIns === 1 ? 'weigh in once more' : `weigh in on ${weighIns} more days`)
  }
  else if (weighInSpanDays > 0) {
    clauses.push(`keep weighing in over ${comingPeriod(weighInSpanDays)}`)
  }

  if (clauses.length === 0) return null
  return `To estimate your maintenance calories from your own logs, ${clauses.join(' and ')}.`
}

// Only a full-confidence, unclamped number is really "from your logs"; anything else is still
// leaning on the profile (formula) estimate and the copy says so.
const isFullyFromLogs = (ready: TdeeReady) => ready.confidence >= 1 && !ready.bounded

// Headline for the Nutrition suggestion card.
export const describeTdeeEstimate = (ready: TdeeReady): string => {
  if (ready.bounded) {
    return ready.formulaTdee === null
      ? `Your logs point to an unusual number, so we've capped this at ${cal(ready.estimate)}.`
      : `Your logs point further from your profile estimate than we'll trust yet, so we've capped this at ${cal(ready.estimate)}.`
  }
  if (!isFullyFromLogs(ready)) {
    return `Blending your logs with your profile estimate, maintenance is about ${cal(ready.estimate)}. This sharpens as you log more.`
  }
  const comparison = ready.formulaTdee === null ? '' : ` (your profile estimate is ${numberFormat.format(Math.round(ready.formulaTdee))})`
  return `Your intake and weight suggest maintenance is about ${cal(ready.estimate)}${comparison}.`
}

// Shorter line for Profile's nutrition target section.
export const describeTdeeEstimateForProfile = (ready: TdeeReady): string =>
  `Your logs put maintenance at about ${cal(ready.estimate)}${isFullyFromLogs(ready) ? '' : ' (early estimate)'}.`

export const formatWeightTrend = (trendKgPerWeek: number, unitSystem: UnitSystem): string => {
  const imperial = unitSystem === 'imperial'
  const value = imperial ? Math.round(kgToLbs(trendKgPerWeek) * 10) / 10 : trendKgPerWeek
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±'
  return `${sign}${Math.abs(value)} ${imperial ? 'lb' : 'kg'}/week`
}
