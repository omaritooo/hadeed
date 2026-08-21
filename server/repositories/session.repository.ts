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

export interface LogSetInput {
  id: string
  exerciseLogId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rpe: number | null
}

export interface AddFreeformExerciseInput {
  id: string
  sessionId: string
  exerciseId: string
  position: number
  setType: SetType
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

  async logSet(input: LogSetInput): Promise<SetLog> {
    const result = await this.db.execute({
      sql: `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, rpe) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [input.id, input.exerciseLogId, input.setNumber, input.weightKg, input.reps, input.rpe],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to log set')
    return this.mapSetLog(row as unknown as Record<string, unknown>)
  }

  async addFreeformExercise(input: AddFreeformExerciseInput): Promise<ExerciseLog> {
    const result = await this.db.execute({
      sql: `INSERT INTO exercise_logs (id, session_id, exercise_id, split_exercise_id, position, set_type, target_sets, target_reps, target_rpe)
            VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, NULL) RETURNING *`,
      args: [input.id, input.sessionId, input.exerciseId, input.position, input.setType],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to add freeform exercise')
    return this.mapExerciseLog(row as unknown as Record<string, unknown>)
  }

  async isComplete(sessionId: string): Promise<boolean> {
    const session = await this.findSessionById(sessionId)
    if (!session) return false

    if (session.splitDayId === null) {
      const result = await this.db.execute({
        sql: `SELECT COUNT(*) as count FROM set_logs
              JOIN exercise_logs ON exercise_logs.id = set_logs.exercise_log_id
              WHERE exercise_logs.session_id = ?`,
        args: [sessionId],
      })
      const countRow = result.rows[0] as unknown as Record<string, unknown> | undefined
      return ((countRow?.count as number) ?? 0) > 0
    }

    const result = await this.db.execute({
      sql: `SELECT exercise_logs.target_sets as target_sets, COUNT(set_logs.id) as logged
            FROM exercise_logs
            LEFT JOIN set_logs ON set_logs.exercise_log_id = exercise_logs.id
            WHERE exercise_logs.session_id = ? AND exercise_logs.split_exercise_id IS NOT NULL
            GROUP BY exercise_logs.id`,
      args: [sessionId],
    })
    if (result.rows.length === 0) return true

    return result.rows.every((row) => {
      const r = row as unknown as Record<string, unknown>
      const target = (r.target_sets as number) ?? 1
      const logged = r.logged as number
      return logged >= target
    })
  }
}
