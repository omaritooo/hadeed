import type { SetType } from '~~/shared/types/split.types'

export type SessionStatus = 'in_progress' | 'completed' | 'abandoned'

export interface WorkoutSession {
  id: string
  userId: string
  splitDayId: number | null
  status: SessionStatus
  startedAt: string
  completedAt: string | null
  version: number
}

export interface ExerciseLog {
  id: string
  sessionId: string
  exerciseId: string
  splitExerciseId: number | null
  position: number
  setType: SetType
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}

export interface SetLog {
  id: string
  exerciseLogId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rpe: number | null
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
