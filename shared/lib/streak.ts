export interface StreakWeek {
  weekStart: string // Monday, YYYY-MM-DD (UTC)
  scheduled: number // non-rest days in that week's block; 0 = neutral week
  completed: number // distinct days with a completed session
}

export interface WeekStreak {
  current: number
  longest: number
  thisWeek: { completed: number, required: number, scheduled: number }
}

export interface BlockSchedule {
  startDate: string
  endDate: string | null
  trainingDays: number
}

// One session of grace per week: a 4-day split counts with 3. Never below one, so a 1-day
// split still needs its session.
export const requiredSessions = (scheduled: number): number => Math.max(1, scheduled - 1)

const isNeutral = (week: StreakWeek) => week.scheduled === 0
const isHit = (week: StreakWeek) => !isNeutral(week) && week.completed >= requiredSessions(week.scheduled)

export const computeWeekStreak = (weeks: StreakWeek[], currentWeekStart: string): WeekStreak => {
  const sorted = [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  const thisWeekEntry = sorted.find(w => w.weekStart === currentWeekStart)

  let current = 0
  const finished = sorted.filter(w => w.weekStart < currentWeekStart)
  for (let i = finished.length - 1; i >= 0; i--) {
    const week = finished[i]!
    // A gap between splits shouldn't wipe a run, so neutral weeks are stepped over.
    if (isNeutral(week)) continue
    if (!isHit(week)) break
    current++
  }
  // The in-progress week can only add to the streak; it can't break it until it has finished.
  if (thisWeekEntry && isHit(thisWeekEntry)) current++

  let longest = 0
  let run = 0
  for (const week of sorted) {
    if (week.weekStart > currentWeekStart || isNeutral(week)) continue
    if (isHit(week)) {
      run++
      longest = Math.max(longest, run)
    }
    else if (week.weekStart < currentWeekStart) {
      run = 0
    }
  }

  const scheduled = thisWeekEntry?.scheduled ?? 0
  return {
    current,
    longest,
    thisWeek: { completed: thisWeekEntry?.completed ?? 0, required: scheduled === 0 ? 0 : requiredSessions(scheduled), scheduled },
  }
}

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const activeOn = (schedules: BlockSchedule[], isoDate: string): BlockSchedule | undefined =>
  schedules
    .filter(s => s.startDate <= isoDate && (s.endDate === null || s.endDate >= isoDate))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]

// Every week from the earliest trained week to the current one, so missed weeks in between
// appear (as scheduled > 0, completed 0) rather than silently vanishing.
export const buildStreakWeeks = (input: {
  schedules: BlockSchedule[]
  completedDaysByWeek: Record<string, number>
  currentWeekStart: string
}): StreakWeek[] => {
  const trainedWeeks = Object.keys(input.completedDaysByWeek).sort()
  const firstWeek = trainedWeeks[0]
  if (!firstWeek) return []

  const weeks: StreakWeek[] = []
  for (let weekStart = firstWeek; weekStart <= input.currentWeekStart; weekStart = addDays(weekStart, 7)) {
    // A block that started mid-week still shapes that week, so Sunday is the fallback.
    const block = activeOn(input.schedules, weekStart) ?? activeOn(input.schedules, addDays(weekStart, 6))
    weeks.push({ weekStart, scheduled: block?.trainingDays ?? 0, completed: input.completedDaysByWeek[weekStart] ?? 0 })
  }
  return weeks
}
