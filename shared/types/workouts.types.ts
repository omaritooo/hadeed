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

// One week's per-muscle volume, banded the same way as MuscleVolume above. Reusing that exact
// sub-shape (rather than flat {weekStart, muscleId, muscleName, setCount} rows) means the Stats
// tab can render each week with whatever component already renders a single week's MuscleVolume[]
// (e.g. the same low/optimal/high bar), just repeated across weeks — no client-side pivoting of
// flat rows into per-week groups needed.
export interface WeeklyVolumeSnapshot {
  weekStart: string // YYYY-MM-DD, UTC Monday start of that week (see server/utils/date.ts#startOfWeek)
  muscles: MuscleVolume[]
}

export const WEEKLY_VOLUME_HISTORY_DEFAULT_WEEKS = 8
export const WEEKLY_VOLUME_HISTORY_MAX_WEEKS = 12

export interface PastWorkoutOptions {
  // Non-rest days of the block active today, in weekday order, shaped like today's workout.
  days: TodaysWorkout[]
}
