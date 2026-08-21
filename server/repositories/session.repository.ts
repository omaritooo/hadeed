import type { Client } from '@libsql/client'
import type { SetType } from '~~/shared/types/split.types'
import type {
  ExerciseLog,
  SessionStatus,
  SetLog,
  WorkoutSession,
  WorkoutSessionWithLogs,
} from '~~/shared/types/session.types'

export interface StartSessionExerciseInput {
  id: string
  exerciseId: string
  splitExerciseId: number | null
  position: number
  setType: SetType
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}

export interface StartSessionInput {
  id: string
  splitDayId: number | null
  exercises: StartSessionExerciseInput[]
}

export class SessionRepository {
  constructor(private db: Client) {}

  private mapSession(row: Record<string, unknown>): WorkoutSession {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      splitDayId: row.split_day_id as number | null,
      status: row.status as SessionStatus,
      startedAt: row.started_at as string,
      completedAt: row.completed_at as string | null,
      version: row.version as number,
    }
  }

  private mapExerciseLog(row: Record<string, unknown>): ExerciseLog {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      exerciseId: row.exercise_id as string,
      splitExerciseId: row.split_exercise_id as number | null,
      position: row.position as number,
      setType: row.set_type as SetType,
      targetSets: row.target_sets as number | null,
      targetReps: row.target_reps as number | null,
      targetRpe: row.target_rpe as number | null,
    }
  }

  private mapSetLog(row: Record<string, unknown>): SetLog {
    return {
      id: row.id as string,
      exerciseLogId: row.exercise_log_id as string,
      setNumber: row.set_number as number,
      weightKg: row.weight_kg as number | null,
      reps: row.reps as number | null,
      rpe: row.rpe as number | null,
      loggedAt: row.logged_at as string,
      version: row.version as number,
    }
  }

  async startSession(userId: string, input: StartSessionInput): Promise<WorkoutSession> {
    const result = await this.db.execute({
      sql: 'INSERT INTO workout_sessions (id, user_id, split_day_id) VALUES (?, ?, ?) RETURNING *',
      args: [input.id, userId, input.splitDayId],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to start session')
    const session = this.mapSession(row as unknown as Record<string, unknown>)

    for (const exercise of input.exercises) {
      await this.db.execute({
        sql: `INSERT INTO exercise_logs (id, session_id, exercise_id, split_exercise_id, position, set_type, target_sets, target_reps, target_rpe)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          exercise.id,
          session.id,
          exercise.exerciseId,
          exercise.splitExerciseId,
          exercise.position,
          exercise.setType,
          exercise.targetSets,
          exercise.targetReps,
          exercise.targetRpe,
        ],
      })
    }

    return session
  }

  async findSessionById(sessionId: string): Promise<WorkoutSession | null> {
    const result = await this.db.execute({ sql: 'SELECT * FROM workout_sessions WHERE id = ?', args: [sessionId] })
    const row = result.rows[0]
    return row ? this.mapSession(row as unknown as Record<string, unknown>) : null
  }

  async findWithLogs(sessionId: string): Promise<WorkoutSessionWithLogs | null> {
    const session = await this.findSessionById(sessionId)
    if (!session) return null

    const exercisesResult = await this.db.execute({
      sql: 'SELECT * FROM exercise_logs WHERE session_id = ? ORDER BY position',
      args: [sessionId],
    })
    const exercises = await Promise.all(
      exercisesResult.rows.map(async (exRow) => {
        const exerciseLog = this.mapExerciseLog(exRow as unknown as Record<string, unknown>)
        const setsResult = await this.db.execute({
          sql: 'SELECT * FROM set_logs WHERE exercise_log_id = ? ORDER BY set_number',
          args: [exerciseLog.id],
        })
        const sets = setsResult.rows.map(setRow => this.mapSetLog(setRow as unknown as Record<string, unknown>))
        return { ...exerciseLog, sets }
      }),
    )

    return { ...session, exercises }
  }
}
