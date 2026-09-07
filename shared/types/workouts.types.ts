import type { ActiveSessionSummary, RecentPr, RecentSessionSummary, TodaysWorkout } from '~~/shared/types/home.types'

export interface WorkoutsSummary {
  todaysWorkout: TodaysWorkout | null
  activeSession: ActiveSessionSummary | null
  recentSessions: RecentSessionSummary[]
  recentPrs: RecentPr[]
}

export type VolumeBand = 'low' | 'optimal' | 'high'

export interface MuscleVolume {
  muscleName: string
  setCount: number
  band: VolumeBand
}
