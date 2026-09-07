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

// MAV (maximum adaptive volume) thresholds, per the design doc's cited research: fewer weekly sets
// than the low threshold under-stimulates the muscle, more than the high threshold risks junk volume.
// Shared by the service (banding) and the UI (progress-bar fill) so the two can't drift apart.
export const WEEKLY_VOLUME_LOW_THRESHOLD = 10
export const WEEKLY_VOLUME_HIGH_THRESHOLD = 22
