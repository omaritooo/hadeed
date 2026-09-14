export interface TdeeMissing {
  loggedDays: number
  weighIns: number
  weighInSpanDays: number
}

const plural = (count: number, singular: string) => `${count} ${singular}${count === 1 ? '' : 's'}`

// One sentence telling the user what's left before their TDEE can come from their own logs.
// Every combination of shortfalls gets its own grammatical phrasing; null when nothing is
// missing, so callers can hide the line rather than render an empty instruction.
export const describeTdeeMissing = (missing: TdeeMissing): string | null => {
  const { loggedDays, weighIns, weighInSpanDays } = missing
  const clauses: string[] = []

  if (loggedDays > 0) clauses.push(`log meals on ${plural(loggedDays, 'more day')}`)

  // Weigh-ins count once per calendar day, so "on N more days" is the accurate unit. Weighing
  // in on N new days going forward already stretches the span by at least N days, so the span
  // is only worth spelling out when it needs more than that (which also avoids "the next 1 day").
  if (weighIns === 1 && weighInSpanDays > 1) {
    clauses.push(`weigh in once more, at least ${weighInSpanDays} days from now`)
  }
  else if (weighIns > 1 && weighInSpanDays > weighIns) {
    clauses.push(`weigh in on ${weighIns} more days, spread across the next ${weighInSpanDays} days`)
  }
  else if (weighIns > 0) {
    clauses.push(weighIns === 1 ? 'weigh in once more' : `weigh in on ${weighIns} more days`)
  }
  else if (weighInSpanDays > 0) {
    clauses.push(`keep weighing in for ${plural(weighInSpanDays, 'more day')}`)
  }

  if (clauses.length === 0) return null
  return `To estimate your TDEE from your own data, ${clauses.join(' and ')}.`
}
