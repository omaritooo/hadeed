export interface TodaysWorkoutExercise {
  exerciseId: string
  exerciseName: string
  targetSets: number | null
  targetReps: number | null
}

export interface TodaysWorkout {
  splitDayId: number
  blockId: number
  dayName: string
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
  startedAt: string
  completedAt: string
  durationMinutes: number | null
  topExerciseName: string | null
  topWeightKg: number | null
  topReps: number | null
}

export interface RecentPr {
  exerciseName: string
  weightKg: number
  reps: number
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

export interface HomeSummary {
  streak: { current: number, longest: number }
  xp: { total: number, level: number, xpIntoLevel: number, xpForNextLevel: number }
  todaysWorkout: TodaysWorkout | null
  activeSession: ActiveSessionSummary | null
  weeklyProgress: { trainedDays: number, scheduledDays: number, volumeKg: number }
  recentSession: RecentSessionSummary | null
  recentPrs: RecentPr[]
  recentAchievements: UnlockedAchievementSummary[]
  weightTrend: WeightTrendPoint[]
}
