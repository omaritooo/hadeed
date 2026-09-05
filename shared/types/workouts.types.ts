import type { ActiveSessionSummary, RecentPr, RecentSessionSummary, TodaysWorkout } from '~~/shared/types/home.types'

export interface WorkoutsSummary {
  todaysWorkout: TodaysWorkout | null
  activeSession: ActiveSessionSummary | null
  recentSessions: RecentSessionSummary[]
  recentPrs: RecentPr[]
}
