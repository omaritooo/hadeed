import type { SetType, SplitFormat } from '~~/shared/types/split.types'
import type { SessionPrHit } from '~~/shared/types/session.types'
import type { WeekStreak } from '~~/shared/lib/streak'

export interface TodaysWorkoutExercise {
  exerciseId: string
  exerciseName: string
  splitExerciseId: number
  position: number
  setType: SetType
  targetSets: number | null
  targetRepsMin: number | null
  targetRepsMax: number | null
  /** @deprecated Equals targetRepsMin. Sent only for older app builds and removed in Task 15. Read targetRepsMin / targetRepsMax. */
  targetReps?: number | null
  targetRpe: number | null
  restSeconds: number | null
  thumbnailUrl: string | null
  primaryMuscle: string | null
  lastPerformed: { weightKg: number, reps: number, date: string } | null
}

export interface TodaysWorkout {
  splitDayId: number
  blockId: number
  dayName: string
  format: SplitFormat
  rounds: number
  exercises: TodaysWorkoutExercise[]
}

export interface ActiveSessionSummary {
  sessionId: string
  splitDayId: number | null
  startedAt: string
  setsLogged: number
}

export interface RecentSessionSummary {
  sessionId: string
  dayName: string | null
  startedAt: string
  completedAt: string
  durationMinutes: number | null
  loggedRetroactively: boolean
  topExerciseName: string | null
  topWeightKg: number | null
  topReps: number | null
}

export interface RecentPr extends SessionPrHit {
  achievedAt: string
}

export interface UnlockedAchievementSummary {
  key: string
  name: string
  icon: string | null
  unlockedAt: string
}

export interface WeightTrendPoint {
  recordedAt: string
  weightKg: number
}

export interface ConsistencyDay {
  date: string
  active: boolean
}

export interface HomeSummary {
  streak: WeekStreak
  xp: { total: number, level: number, xpIntoLevel: number, xpForNextLevel: number }
  todaysWorkout: TodaysWorkout | null
  activeSession: ActiveSessionSummary | null
  weeklyProgress: { trainedDays: number, scheduledDays: number, volumeKg: number }
  recentSession: RecentSessionSummary | null
  recentPrs: RecentPr[]
  recentAchievements: UnlockedAchievementSummary[]
  weightTrend: WeightTrendPoint[]
  consistency: ConsistencyDay[]
}
