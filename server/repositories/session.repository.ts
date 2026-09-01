import type { Client } from '@libsql/client'
import type { SetType } from '~~/shared/types/split.types'
import type {
  ExerciseHistoryEntry,
  ExerciseLog,
  SessionStatus,
  SetLog,
  WorkoutSession,
  WorkoutSessionWithLogs,
} from '~~/shared/types/session.types'
import type { RecentSessionSummary } from '~~/shared/types/home.types'

const ABANDON_AFTER_HOURS = 12

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

export interface ConflictResult {
  conflict: true
}
export interface SessionCompleteResult {
  conflict: false
  session: WorkoutSession
}

export interface EditSetLogInput {
  weightKg?: number | null
  reps?: number | null
  rpe?: number | null
}
export interface SetLogEditResult {
  conflict: false
  setLog: SetLog
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
    const existing = await this.db.execute({ sql: 'SELECT * FROM workout_sessions WHERE id = ?', args: [input.id] })
    const existingRow = existing.rows[0] as unknown as Record<string, unknown> | undefined

    let session: WorkoutSession
    if (existingRow) {
      session = this.assertOwnedSession(existingRow, userId)
    } else {
      try {
        const result = await this.db.execute({
          sql: 'INSERT INTO workout_sessions (id, user_id, split_day_id) VALUES (?, ?, ?) RETURNING *',
          args: [input.id, userId, input.splitDayId],
        })
        const row = result.rows[0]
        if (!row) throw new Error('Failed to start session')
        session = this.mapSession(row as unknown as Record<string, unknown>)
      } catch (err) {
        if (!this.isUniqueConstraintError(err)) throw err
        const retry = await this.db.execute({ sql: 'SELECT * FROM workout_sessions WHERE id = ?', args: [input.id] })
        const retryRow = retry.rows[0] as unknown as Record<string, unknown> | undefined
        if (!retryRow) throw err
        session = this.assertOwnedSession(retryRow, userId)
      }
    }

    for (const exercise of input.exercises) {
      const existingExerciseLog = await this.db.execute({ sql: 'SELECT session_id FROM exercise_logs WHERE id = ?', args: [exercise.id] })
      const existingExerciseRow = existingExerciseLog.rows[0] as unknown as Record<string, unknown> | undefined
      if (existingExerciseRow) {
        if (existingExerciseRow.session_id !== session.id) throw new Error('Exercise log id already exists under a different session')
        continue
      }

      try {
        const inserted = await this.db.execute({
          sql: `INSERT INTO exercise_logs (id, session_id, exercise_id, split_exercise_id, position, set_type, target_sets, target_reps, target_rpe)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM workout_sessions WHERE id = ? AND status = 'in_progress')
                RETURNING id`,
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
            session.id,
          ],
        })
        if (inserted.rows.length === 0) {
          console.warn('startSession: dropped exercise attach, session is not in progress', { sessionId: session.id, exerciseLogId: exercise.id })
        }
      } catch (err) {
        if (!this.isUniqueConstraintError(err)) throw err
        const retry = await this.db.execute({ sql: 'SELECT session_id FROM exercise_logs WHERE id = ?', args: [exercise.id] })
        const retryRow = retry.rows[0] as unknown as Record<string, unknown> | undefined
        if (!retryRow || retryRow.session_id !== session.id) throw new Error('Exercise log id already exists under a different session', { cause: err })
      }
    }

    return session
  }

  private assertOwnedSession(row: Record<string, unknown>, userId: string): WorkoutSession {
    if (row.user_id !== userId) throw new Error('Session id already exists under a different user')
    return this.mapSession(row)
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Error && /UNIQUE constraint failed/i.test(err.message)
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
    const existing = await this.db.execute({ sql: 'SELECT * FROM set_logs WHERE id = ?', args: [input.id] })
    const existingRow = existing.rows[0] as unknown as Record<string, unknown> | undefined
    if (existingRow) {
      if (existingRow.exercise_log_id !== input.exerciseLogId) throw new Error('Set log id already exists under a different exercise log')
      return this.mapSetLog(existingRow)
    }

    try {
      const result = await this.db.execute({
        sql: `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, rpe)
              SELECT ?, ?, ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM exercise_logs
                JOIN workout_sessions ON workout_sessions.id = exercise_logs.session_id
                WHERE exercise_logs.id = ? AND workout_sessions.status = 'in_progress'
              )
              RETURNING *`,
        args: [input.id, input.exerciseLogId, input.setNumber, input.weightKg, input.reps, input.rpe, input.exerciseLogId],
      })
      const row = result.rows[0]
      if (!row) throw new Error('Cannot log a set: exercise log not found or session is not in progress')
      return this.mapSetLog(row as unknown as Record<string, unknown>)
    } catch (err) {
      if (!this.isUniqueConstraintError(err)) throw err
      const retry = await this.db.execute({ sql: 'SELECT * FROM set_logs WHERE id = ?', args: [input.id] })
      const retryRow = retry.rows[0] as unknown as Record<string, unknown> | undefined
      if (!retryRow) throw err
      if (retryRow.exercise_log_id !== input.exerciseLogId) throw new Error('Set log id already exists under a different exercise log', { cause: err })
      return this.mapSetLog(retryRow)
    }
  }

  async addFreeformExercise(input: AddFreeformExerciseInput): Promise<ExerciseLog> {
    const existing = await this.db.execute({ sql: 'SELECT * FROM exercise_logs WHERE id = ?', args: [input.id] })
    const existingRow = existing.rows[0] as unknown as Record<string, unknown> | undefined
    if (existingRow) {
      if (existingRow.session_id !== input.sessionId) throw new Error('Exercise log id already exists under a different session')
      return this.mapExerciseLog(existingRow)
    }

    try {
      const result = await this.db.execute({
        sql: `INSERT INTO exercise_logs (id, session_id, exercise_id, split_exercise_id, position, set_type, target_sets, target_reps, target_rpe)
              SELECT ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL
              WHERE EXISTS (SELECT 1 FROM workout_sessions WHERE id = ? AND status = 'in_progress')
              RETURNING *`,
        args: [input.id, input.sessionId, input.exerciseId, input.position, input.setType, input.sessionId],
      })
      const row = result.rows[0]
      if (!row) throw new Error('Cannot add exercise: session not found or session is not in progress')
      return this.mapExerciseLog(row as unknown as Record<string, unknown>)
    } catch (err) {
      if (!this.isUniqueConstraintError(err)) throw err
      const retry = await this.db.execute({ sql: 'SELECT * FROM exercise_logs WHERE id = ?', args: [input.id] })
      const retryRow = retry.rows[0] as unknown as Record<string, unknown> | undefined
      if (!retryRow) throw err
      if (retryRow.session_id !== input.sessionId) throw new Error('Exercise log id already exists under a different session', { cause: err })
      return this.mapExerciseLog(retryRow)
    }
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
    if (result.rows.length === 0) return false

    return result.rows.every((row) => {
      const r = row as unknown as Record<string, unknown>
      const target = (r.target_sets as number) ?? 1
      const logged = r.logged as number
      return logged >= target
    })
  }

  async completeSession(sessionId: string, expectedVersion: number): Promise<SessionCompleteResult | ConflictResult> {
    const result = await this.db.execute({
      sql: `UPDATE workout_sessions
            SET status = 'completed', completed_at = datetime('now'), version = version + 1
            WHERE id = ? AND version = ? AND status = 'in_progress'
            RETURNING *`,
      args: [sessionId, expectedVersion],
    })
    const row = result.rows[0]
    if (row) return { conflict: false, session: this.mapSession(row as unknown as Record<string, unknown>) }

    const current = await this.findSessionById(sessionId)
    if (!current) throw new Error('Session not found')

    await this.db.execute({
      sql: `INSERT INTO sync_conflicts (user_id, entity_table, entity_id, server_value, proposed_value, base_version)
            VALUES (?, 'workout_sessions', ?, ?, ?, ?)`,
      args: [
        current.userId,
        sessionId,
        JSON.stringify(current),
        JSON.stringify({ status: 'completed' }),
        expectedVersion,
      ],
    })
    return { conflict: true }
  }

  async editSetLog(setLogId: string, expectedVersion: number, corrections: EditSetLogInput): Promise<SetLogEditResult | ConflictResult> {
    const ALLOWED_KEYS = new Set(['weightKg', 'reps', 'rpe'])
    const keys = Object.keys(corrections)
    if (keys.length === 0) throw new Error('No corrections provided')
    if (!keys.every(k => ALLOWED_KEYS.has(k))) throw new Error('Invalid correction field')

    const columnFor = (key: string) => (key === 'weightKg' ? 'weight_kg' : key)
    const setClause = keys.map(k => `${columnFor(k)} = ?`).join(', ')
    const values: (string | number | null)[] = keys.map(k => corrections[k as keyof EditSetLogInput] ?? null)
    const result = await this.db.execute({
      sql: `UPDATE set_logs SET ${setClause}, version = version + 1
            WHERE id = ? AND version = ?
            RETURNING *`,
      args: [...values, setLogId, expectedVersion],
    })
    const row = result.rows[0]
    if (row) return { conflict: false, setLog: this.mapSetLog(row as unknown as Record<string, unknown>) }

    const currentResult = await this.db.execute({ sql: 'SELECT * FROM set_logs WHERE id = ?', args: [setLogId] })
    const currentRow = currentResult.rows[0]
    if (!currentRow) throw new Error('Set log not found')
    const current = this.mapSetLog(currentRow as unknown as Record<string, unknown>)

    const exerciseLogResult = await this.db.execute({ sql: 'SELECT session_id FROM exercise_logs WHERE id = ?', args: [current.exerciseLogId] })
    const exerciseLogRow = exerciseLogResult.rows[0] as unknown as Record<string, unknown> | undefined
    if (!exerciseLogRow) throw new Error('Exercise log not found')
    const sessionId = exerciseLogRow.session_id as string

    const session = await this.findSessionById(sessionId)
    if (!session) throw new Error('Session not found')

    await this.db.execute({
      sql: `INSERT INTO sync_conflicts (user_id, entity_table, entity_id, server_value, proposed_value, base_version)
            VALUES (?, 'set_logs', ?, ?, ?, ?)`,
      args: [session.userId, setLogId, JSON.stringify(current), JSON.stringify(corrections), expectedVersion],
    })
    return { conflict: true }
  }

  async findSetLogOwnerId(setLogId: string): Promise<string | null> {
    const result = await this.db.execute({
      sql: `SELECT workout_sessions.user_id AS user_id
            FROM set_logs
            JOIN exercise_logs ON exercise_logs.id = set_logs.exercise_log_id
            JOIN workout_sessions ON workout_sessions.id = exercise_logs.session_id
            WHERE set_logs.id = ?`,
      args: [setLogId],
    })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    return row ? (row.user_id as string) : null
  }

  async findExerciseLogOwnerId(exerciseLogId: string): Promise<string | null> {
    const result = await this.db.execute({
      sql: `SELECT workout_sessions.user_id AS user_id
            FROM exercise_logs
            JOIN workout_sessions ON workout_sessions.id = exercise_logs.session_id
            WHERE exercise_logs.id = ?`,
      args: [exerciseLogId],
    })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    return row ? (row.user_id as string) : null
  }

  async findExerciseIdForLog(exerciseLogId: string): Promise<string | null> {
    const result = await this.db.execute({ sql: 'SELECT exercise_id FROM exercise_logs WHERE id = ?', args: [exerciseLogId] })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    return row ? (row.exercise_id as string) : null
  }

  async findBestWeightForExercise(userId: string, exerciseId: string): Promise<number | null> {
    const result = await this.db.execute({
      sql: `SELECT MAX(sl.weight_kg) AS max_weight
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN workout_sessions ws ON ws.id = el.session_id
            WHERE ws.user_id = ? AND el.exercise_id = ? AND sl.weight_kg IS NOT NULL`,
      args: [userId, exerciseId],
    })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    const maxWeight = row?.max_weight
    return typeof maxWeight === 'number' ? maxWeight : null
  }

  async expireStaleSessions(userId: string): Promise<void> {
    await this.db.execute({
      sql: `UPDATE workout_sessions
            SET status = 'abandoned', version = version + 1
            WHERE user_id = ? AND status = 'in_progress'
              AND started_at < datetime('now', ?)`,
      args: [userId, `-${ABANDON_AFTER_HOURS} hours`],
    })
  }

  async findExerciseHistory(userId: string, exerciseId: string): Promise<ExerciseHistoryEntry[]> {
    const result = await this.db.execute({
      sql: `WITH ranked_sets AS (
              SELECT
                ws.id AS session_id,
                COALESCE(ws.completed_at, ws.started_at) AS session_date,
                sl.weight_kg AS weight_kg,
                sl.reps AS reps,
                ROW_NUMBER() OVER (
                  PARTITION BY ws.id
                  ORDER BY sl.weight_kg DESC, sl.reps DESC
                ) AS rn,
                COUNT(*) OVER (PARTITION BY ws.id) AS sets_count
              FROM workout_sessions ws
              JOIN exercise_logs el ON el.session_id = ws.id
              JOIN set_logs sl ON sl.exercise_log_id = el.id
              WHERE ws.user_id = ?
                AND el.exercise_id = ?
                AND sl.weight_kg IS NOT NULL
                AND sl.reps IS NOT NULL
            )
            SELECT session_id, session_date, weight_kg, reps, sets_count
            FROM ranked_sets
            WHERE rn = 1
            ORDER BY session_date DESC`,
      args: [userId, exerciseId],
    })
    return result.rows.map(row => ({
      sessionId: row.session_id as string,
      date: row.session_date as string,
      topSetWeightKg: row.weight_kg as number,
      topSetReps: row.reps as number,
      setsCount: row.sets_count as number,
    }))
  }

  async countTrainedDaysInRange(userId: string, startIso: string, endIso: string): Promise<number> {
    const result = await this.db.execute({
      sql: `SELECT COUNT(DISTINCT date(started_at)) as count FROM workout_sessions
            WHERE user_id = ? AND status = 'completed' AND started_at >= ? AND started_at < ?`,
      args: [userId, startIso, endIso],
    })
    return (result.rows[0]?.count as number) ?? 0
  }

  async totalVolumeKg(userId: string): Promise<number> {
    const result = await this.db.execute({
      sql: `SELECT COALESCE(SUM(sl.weight_kg * sl.reps), 0) AS total
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN workout_sessions ws ON ws.id = el.session_id
            WHERE ws.user_id = ? AND sl.weight_kg IS NOT NULL AND sl.reps IS NOT NULL`,
      args: [userId],
    })
    return (result.rows[0]?.total as number) ?? 0
  }

  async volumeKgInRange(userId: string, startIso: string, endIso: string): Promise<number> {
    const result = await this.db.execute({
      sql: `SELECT COALESCE(SUM(sl.weight_kg * sl.reps), 0) AS total
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN workout_sessions ws ON ws.id = el.session_id
            WHERE ws.user_id = ? AND sl.weight_kg IS NOT NULL AND sl.reps IS NOT NULL
              AND ws.started_at >= ? AND ws.started_at < ?`,
      args: [userId, startIso, endIso],
    })
    return (result.rows[0]?.total as number) ?? 0
  }

  async findActiveForUser(userId: string): Promise<WorkoutSession | null> {
    const result = await this.db.execute({
      sql: `SELECT * FROM workout_sessions WHERE user_id = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1`,
      args: [userId],
    })
    const row = result.rows[0]
    return row ? this.mapSession(row as unknown as Record<string, unknown>) : null
  }

  async findMostRecentSplitDayId(userId: string, splitDayIds: number[]): Promise<number | null> {
    if (splitDayIds.length === 0) return null
    const placeholders = splitDayIds.map(() => '?').join(', ')
    const result = await this.db.execute({
      sql: `SELECT split_day_id FROM workout_sessions
            WHERE user_id = ? AND status = 'completed' AND split_day_id IN (${placeholders})
            ORDER BY started_at DESC LIMIT 1`,
      args: [userId, ...splitDayIds],
    })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    return row ? (row.split_day_id as number) : null
  }

  async findMostRecentCompletedSummary(userId: string): Promise<RecentSessionSummary | null> {
    const sessionResult = await this.db.execute({
      sql: `SELECT *, ROUND((julianday(completed_at) - julianday(started_at)) * 24 * 60) AS duration_minutes
            FROM workout_sessions
            WHERE user_id = ? AND status = 'completed'
            ORDER BY completed_at DESC LIMIT 1`,
      args: [userId],
    })
    const sessionRow = sessionResult.rows[0] as unknown as Record<string, unknown> | undefined
    if (!sessionRow) return null

    const topSetResult = await this.db.execute({
      sql: `SELECT e.name AS exercise_name, sl.weight_kg, sl.reps
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN exercises e ON e.id = el.exercise_id
            WHERE el.session_id = ? AND sl.weight_kg IS NOT NULL
            ORDER BY sl.weight_kg DESC, sl.reps DESC LIMIT 1`,
      args: [sessionRow.id as string],
    })
    const topSetRow = topSetResult.rows[0] as unknown as Record<string, unknown> | undefined

    return {
      sessionId: sessionRow.id as string,
      startedAt: sessionRow.started_at as string,
      completedAt: sessionRow.completed_at as string,
      durationMinutes: sessionRow.duration_minutes as number | null,
      topExerciseName: (topSetRow?.exercise_name as string) ?? null,
      topWeightKg: (topSetRow?.weight_kg as number) ?? null,
      topReps: (topSetRow?.reps as number) ?? null,
    }
  }
}
