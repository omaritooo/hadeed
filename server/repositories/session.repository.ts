import type { Client } from '@libsql/client'
import type { SetType } from '~~/shared/types/split.types'
import type {
  ExerciseLog,
  SessionStatus,
  SetLog,
  WorkoutSession,
  WorkoutSessionWithLogs,
} from '~~/shared/types/session.types'

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
    // Idempotent replay must never be a bare "id already exists -> return whatever's there"
    // check: that would let anyone read back another user's real row just by resubmitting
    // its (leaked or guessed) id. A replay is only genuine if the existing row's owner
    // actually matches this caller; anything else is a real id collision and must be
    // rejected, not silently disclosed.
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
        // Two concurrent replays of the same offline mutation can both pass the "not found"
        // check above and race on this INSERT; the loser hits a raw UNIQUE violation instead
        // of a clean outcome. Re-resolve it exactly like a sequential replay would have.
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
        continue // already applied by an earlier attempt at this same call; no-op
      }

      // Unlike logSet/addFreeformExercise (single-purpose user actions that must report a
      // definitive success/failure), this loop seeds a batch snapshot at session-start time,
      // so a genuinely-new exercise that loses the status race (session completed/abandoned
      // between the check above and here) is silently skipped rather than aborting the rest
      // of an otherwise-successful start. Logged so a dropped attach is diagnosable later.
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
        // Concurrent replay racing on this exercise-log id: another attempt already applied
        // it first, which is exactly the no-op outcome this loop wants, so swallow silently
        // unless the row that won belongs to a different session entirely.
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
    // Idempotent replay must verify the pre-existing row actually belongs to the exercise
    // log the caller claims, not just that the id exists — a bare id-exists check would let
    // a caller "replay" a leaked/guessed id and read back someone else's real set data via
    // the RETURNING clause of an upsert. A true replay's exerciseLogId always matches; a
    // real collision does not, and must be rejected rather than treated as a no-op.
    const existing = await this.db.execute({ sql: 'SELECT * FROM set_logs WHERE id = ?', args: [input.id] })
    const existingRow = existing.rows[0] as unknown as Record<string, unknown> | undefined
    if (existingRow) {
      if (existingRow.exercise_log_id !== input.exerciseLogId) throw new Error('Set log id already exists under a different exercise log')
      return this.mapSetLog(existingRow) // already applied; replay succeeds as a no-op regardless of current session status
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
      // Two concurrent replays of the same set can both pass the "not found" check above and
      // race on this INSERT; the loser hits a raw UNIQUE violation instead of a clean no-op.
      // Re-resolve it exactly like a sequential replay would have.
      if (!this.isUniqueConstraintError(err)) throw err
      const retry = await this.db.execute({ sql: 'SELECT * FROM set_logs WHERE id = ?', args: [input.id] })
      const retryRow = retry.rows[0] as unknown as Record<string, unknown> | undefined
      if (!retryRow) throw err
      if (retryRow.exercise_log_id !== input.exerciseLogId) throw new Error('Set log id already exists under a different exercise log', { cause: err })
      return this.mapSetLog(retryRow)
    }
  }

  async addFreeformExercise(input: AddFreeformExerciseInput): Promise<ExerciseLog> {
    // Same idempotent-replay-vs-fresh-write reasoning as logSet above: verify the existing
    // row's sessionId matches before treating it as a no-op, rather than a bare id check.
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
      // Same concurrent-replay race as logSet above.
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
    // A planned session with zero split-linked exercise logs has nothing to have completed
    // (e.g. it was started with an empty/mismatched exercises snapshot) — vacuously "every
    // planned exercise met its target" is true over an empty set, but that's not a workout
    // that happened. Mirror the freeform branch above: nothing logged means not complete.
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
    const result = await this.db.execute({
      sql: `UPDATE set_logs SET ${setClause}, version = version + 1
            WHERE id = ? AND version = ?
            RETURNING *`,
      args: [...keys.map(k => (corrections as Record<string, unknown>)[k]), setLogId, expectedVersion],
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

  async expireStaleSessions(userId: string): Promise<void> {
    await this.db.execute({
      sql: `UPDATE workout_sessions
            SET status = 'abandoned', version = version + 1
            WHERE user_id = ? AND status = 'in_progress'
              AND started_at < datetime('now', ?)`,
      args: [userId, `-${ABANDON_AFTER_HOURS} hours`],
    })
  }

  async countTrainedDaysInRange(userId: string, startIso: string, endIso: string): Promise<number> {
    const result = await this.db.execute({
      sql: `SELECT COUNT(DISTINCT date(started_at)) as count FROM workout_sessions
            WHERE user_id = ? AND status = 'completed' AND started_at >= ? AND started_at < ?`,
      args: [userId, startIso, endIso],
    })
    return (result.rows[0]?.count as number) ?? 0
  }
}
