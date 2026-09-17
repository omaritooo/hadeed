import type { SetType, SplitFormat } from '~~/shared/types/split.types'
import type { ProgressionSuggestion } from '~~/shared/lib/progression'

export type SessionStatus = 'in_progress' | 'completed' | 'abandoned'

export interface WorkoutSession {
  id: string
  userId: string
  splitDayId: number | null
  status: SessionStatus
  startedAt: string
  completedAt: string | null
  version: number
  // Snapshotted from split_days/preset_split_days.format/rounds at session-start time.
  format: SplitFormat
  rounds: number
}

export interface ExerciseLog {
  id: string
  sessionId: string
  exerciseId: string
  exerciseName: string | null
  splitExerciseId: number | null
  position: number
  setType: SetType
  targetSets: number | null
  targetRepsMin: number | null
  targetRepsMax: number | null
  /** @deprecated Equals targetRepsMin. Sent only for older app builds and removed in Task 15. Read targetRepsMin / targetRepsMax. */
  targetReps?: number | null
  targetRpe: number | null
  restSeconds: number | null
  // What progression suggested for this exercise when the session started, snapshotted so a
  // past session still shows the advice it was logged against.
  suggestion: ProgressionSuggestion | null
}

export interface SetLog {
  id: string
  exerciseLogId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rpe: number | null
  isWarmup: boolean
  loggedAt: string
  version: number
}

export interface WorkoutSessionWithLogs extends WorkoutSession {
  exercises: (ExerciseLog & { sets: SetLog[] })[]
}

export interface ExerciseHistoryEntry {
  sessionId: string
  date: string
  topSetWeightKg: number
  topSetReps: number
  setsCount: number
  // Working sets only, in set order.
  sets: ExerciseHistorySet[]
}

export interface ExerciseHistorySet {
  setNumber: number
  weightKg: number
  reps: number
}

export interface SessionPrHit {
  exerciseName: string
  weightKg: number
  reps: number
}

// Returned by SessionService.completeSession alongside the completed session itself, to drive
// the post-workout summary screen. `prsHit` is looked up from recorded xp_ledger('pr') entries
// for sets logged in this session (see XpRepository.findPrsForSession) rather than re-derived
// from set_logs at completion time — by completion time this session's own working sets are
// already in set_logs, so a fresh best-weight lookup could no longer tell a PR set apart from
// the new baseline it just became.
export interface SessionCompletionSummary {
  totalVolumeKg: number
  durationMinutes: number
  prsHit: SessionPrHit[]
  currentStreak: number
}

export type SyncEntityTable = 'set_logs' | 'workout_sessions'
export type SyncConflictResolution = 'kept_mine' | 'kept_server' | 'manual'

export interface SyncConflict {
  id: number
  userId: string
  entityTable: SyncEntityTable
  entityId: string
  serverValue: Record<string, unknown>
  proposedValue: Record<string, unknown>
  baseVersion: number
  detectedAt: string
  resolvedAt: string | null
  resolution: SyncConflictResolution | null
}
