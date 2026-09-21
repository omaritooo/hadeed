import type { Client, InArgs } from '@libsql/client'
import { repRangeArgs, repRangeFromRow } from '~~/server/repositories/rep-range-columns'
import type { SetType, SplitFormat } from '~~/shared/types/split.types'
import type {
  ExerciseHistoryEntry,
  ExerciseLog,
  SessionStatus,
  SetLog,
  WorkoutSession,
  WorkoutSessionWithLogs,
} from '~~/shared/types/session.types'
import type { RecentSessionSummary } from '~~/shared/types/home.types'
import type { ProgressionSuggestion, SuggestionAction, SuggestionReason, WorkingSet } from '~~/shared/lib/progression'

const ABANDON_AFTER_HOURS = 12

export interface StartSessionExerciseInput {
  id: string
  exerciseId: string
  splitExerciseId: number | null
  position: number
  setType: SetType
  targetSets: number | null
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetRpe: number | null
  restSeconds?: number | null
  // Snapshotted as-suggested at session start, same as restSeconds. Older app builds don't send
  // it, so the columns stay null and the log reports no suggestion.
  suggestion?: ProgressionSuggestion | null
}

export interface StartSessionInput {
  id: string
  splitDayId: number | null
  exercises: StartSessionExerciseInput[]
  // Snapshotted from the originating split_day/preset_split_day at session-start time (same
  // pattern as StartSessionExerciseInput.restSeconds) — a whole session is either a circuit or
  // straight sets, so this is session-level rather than per-exercise.
  format?: SplitFormat
  rounds?: number
}

export interface InsertPastSessionInput {
  id: string
  splitDayId: number | null
  startedAt: string // SQLite datetime
  completedAt: string
  exercises: Array<Omit<StartSessionExerciseInput, 'restSeconds' | 'suggestion'> & {
    sets: Array<{ id: string, setNumber: number, weightKg: number | null, reps: number | null, loggedAt: string }>
  }>
}

export interface LogSetInput {
  id: string
  exerciseLogId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rpe: number | null
  isWarmup?: boolean
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
  isWarmup?: boolean
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
      format: row.format as SplitFormat,
      rounds: row.rounds as number,
      loggedRetroactively: Boolean(row.logged_retroactively),
    }
  }

  private mapExerciseLog(row: Record<string, unknown>): ExerciseLog {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      exerciseId: row.exercise_id as string,
      exerciseName: (row.exercise_name as string | undefined) ?? null,
      splitExerciseId: row.split_exercise_id as number | null,
      position: row.position as number,
      setType: row.set_type as SetType,
      targetSets: row.target_sets as number | null,
      ...repRangeFromRow(row),
      targetRpe: row.target_rpe as number | null,
      restSeconds: row.rest_seconds as number | null,
      // suggestion_action is the presence flag: it and the rep ends are always written together,
      // so a row without an action was logged before/without a suggestion rather than partially.
      suggestion: row.suggestion_action
        ? {
            action: row.suggestion_action as SuggestionAction,
            reason: row.suggestion_reason as SuggestionReason,
            weightKg: row.suggested_weight_kg as number | null,
            repsMin: row.suggested_reps_min as number,
            repsMax: row.suggested_reps_max as number,
          }
        : null,
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
      isWarmup: Boolean(row.is_warmup),
      loggedAt: row.logged_at as string,
      version: row.version as number,
    }
  }

  async startSession(userId: string, input: StartSessionInput): Promise<WorkoutSession> {
    const session = await this.insertIdempotent({
      selectSql: 'SELECT * FROM workout_sessions WHERE id = ?',
      selectArgs: [input.id],
      insertSql: 'INSERT INTO workout_sessions (id, user_id, split_day_id, format, rounds) VALUES (?, ?, ?, ?, ?) RETURNING *',
      insertArgs: [input.id, userId, input.splitDayId, input.format ?? 'straight_sets', input.rounds ?? 1],
      scopeField: 'user_id',
      scopeValue: userId,
      scopeErrorMessage: 'Session id already exists under a different user',
      notFoundErrorMessage: 'Failed to start session',
      map: row => this.mapSession(row),
    })

    for (const exercise of input.exercises) {
      await this.attachExercise(session, exercise)
    }

    return session
  }

  private async attachExercise(session: WorkoutSession, exercise: StartSessionExerciseInput): Promise<void> {
    const existingExerciseLog = await this.db.execute({ sql: 'SELECT session_id FROM exercise_logs WHERE id = ?', args: [exercise.id] })
    const existingExerciseRow = existingExerciseLog.rows[0] as unknown as Record<string, unknown> | undefined
    if (existingExerciseRow) {
      if (existingExerciseRow.session_id !== session.id) throw new Error('Exercise log id already exists under a different session')
      return
    }

    const suggestion = exercise.suggestion
    try {
      const inserted = await this.db.execute({
        sql: `INSERT INTO exercise_logs (id, session_id, exercise_id, split_exercise_id, position, set_type, target_sets, target_reps, target_reps_min, target_reps_max, target_rpe, rest_seconds, suggested_weight_kg, suggested_reps_min, suggested_reps_max, suggestion_action, suggestion_reason)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM workout_sessions WHERE id = ? AND status = 'in_progress')
              RETURNING id`,
        args: [
          exercise.id,
          session.id,
          exercise.exerciseId,
          exercise.splitExerciseId ?? null,
          exercise.position,
          exercise.setType,
          exercise.targetSets ?? null,
          ...repRangeArgs(exercise),
          exercise.targetRpe ?? null,
          exercise.restSeconds ?? null,
          suggestion?.weightKg ?? null,
          suggestion?.repsMin ?? null,
          suggestion?.repsMax ?? null,
          suggestion?.action ?? null,
          suggestion?.reason ?? null,
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

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Error && /UNIQUE constraint failed/i.test(err.message)
  }

  /**
   * Idempotent insert-by-id: if a row with the given id already exists, validates it belongs
   * to the expected scope (owning user/session/exercise log) and returns it as-is; otherwise
   * inserts it, retrying the lookup once if a concurrent insert wins the unique-constraint race.
   */
  private async insertIdempotent<T>(options: {
    selectSql: string
    selectArgs: InArgs
    insertSql: string
    insertArgs: InArgs
    scopeField: string
    scopeValue: unknown
    scopeErrorMessage: string
    notFoundErrorMessage: string
    map: (row: Record<string, unknown>) => T
  }): Promise<T> {
    const existing = await this.db.execute({ sql: options.selectSql, args: options.selectArgs })
    const existingRow = existing.rows[0] as unknown as Record<string, unknown> | undefined
    if (existingRow) {
      if (existingRow[options.scopeField] !== options.scopeValue) throw new Error(options.scopeErrorMessage)
      return options.map(existingRow)
    }

    try {
      const result = await this.db.execute({ sql: options.insertSql, args: options.insertArgs })
      const row = result.rows[0]
      if (!row) throw new Error(options.notFoundErrorMessage)
      return options.map(row as unknown as Record<string, unknown>)
    } catch (err) {
      if (!this.isUniqueConstraintError(err)) throw err
      const retry = await this.db.execute({ sql: options.selectSql, args: options.selectArgs })
      const retryRow = retry.rows[0] as unknown as Record<string, unknown> | undefined
      if (!retryRow) throw err
      if (retryRow[options.scopeField] !== options.scopeValue) throw new Error(options.scopeErrorMessage, { cause: err })
      return options.map(retryRow)
    }
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
      sql: `SELECT exercise_logs.*, exercises.name AS exercise_name
            FROM exercise_logs
            LEFT JOIN exercises ON exercises.id = exercise_logs.exercise_id
            WHERE exercise_logs.session_id = ?
            ORDER BY exercise_logs.position`,
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
    return this.insertIdempotent({
      selectSql: 'SELECT * FROM set_logs WHERE id = ?',
      selectArgs: [input.id],
      insertSql: `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, rpe, is_warmup)
                  SELECT ?, ?, ?, ?, ?, ?, ?
                  WHERE EXISTS (
                    SELECT 1 FROM exercise_logs
                    JOIN workout_sessions ON workout_sessions.id = exercise_logs.session_id
                    WHERE exercise_logs.id = ? AND workout_sessions.status = 'in_progress'
                  )
                  RETURNING *`,
      insertArgs: [input.id, input.exerciseLogId, input.setNumber, input.weightKg, input.reps, input.rpe, input.isWarmup ? 1 : 0, input.exerciseLogId],
      scopeField: 'exercise_log_id',
      scopeValue: input.exerciseLogId,
      scopeErrorMessage: 'Set log id already exists under a different exercise log',
      notFoundErrorMessage: 'Cannot log a set: exercise log not found or session is not in progress',
      map: row => this.mapSetLog(row),
    })
  }

  async addFreeformExercise(input: AddFreeformExerciseInput): Promise<ExerciseLog> {
    return this.insertIdempotent({
      selectSql: 'SELECT * FROM exercise_logs WHERE id = ?',
      selectArgs: [input.id],
      insertSql: `INSERT INTO exercise_logs (id, session_id, exercise_id, split_exercise_id, position, set_type, target_sets, target_reps, target_reps_min, target_reps_max, target_rpe, rest_seconds)
                  SELECT ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL
                  WHERE EXISTS (SELECT 1 FROM workout_sessions WHERE id = ? AND status = 'in_progress')
                  RETURNING *`,
      insertArgs: [input.id, input.sessionId, input.exerciseId, input.position, input.setType, input.sessionId],
      scopeField: 'session_id',
      scopeValue: input.sessionId,
      scopeErrorMessage: 'Exercise log id already exists under a different session',
      notFoundErrorMessage: 'Cannot add exercise: session not found or session is not in progress',
      map: row => this.mapExerciseLog(row),
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
    const ALLOWED_KEYS = new Set(['weightKg', 'reps', 'rpe', 'isWarmup'])
    const keys = Object.keys(corrections)
    if (keys.length === 0) throw new Error('No corrections provided')
    if (!keys.every(k => ALLOWED_KEYS.has(k))) throw new Error('Invalid correction field')

    const columnFor = (key: string) => (key === 'weightKg' ? 'weight_kg' : key === 'isWarmup' ? 'is_warmup' : key)
    const setClause = keys.map(k => `${columnFor(k)} = ?`).join(', ')
    const values: (string | number | null)[] = keys.map((k) => {
      if (k === 'isWarmup') return corrections.isWarmup ? 1 : 0
      return (corrections[k as keyof EditSetLogInput] as string | number | null | undefined) ?? null
    })
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

  // No expectedVersion/conflict handling here: unlike editSetLog, a delete has no partial
  // state to lose — the row either still exists (delete it) or is already gone (no-op).
  async deleteSetLog(setLogId: string): Promise<void> {
    await this.db.execute({
      sql: 'DELETE FROM set_logs WHERE id = ?',
      args: [setLogId],
    })
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

  // Excludes warm-up sets: a light warm-up rep should never establish (or beat) the PR baseline.
  async findBestWeightForExercise(userId: string, exerciseId: string): Promise<number | null> {
    const result = await this.db.execute({
      sql: `SELECT MAX(sl.weight_kg) AS max_weight
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN workout_sessions ws ON ws.id = el.session_id
            WHERE ws.user_id = ? AND el.exercise_id = ? AND sl.weight_kg IS NOT NULL AND sl.is_warmup = 0`,
      args: [userId, exerciseId],
    })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    const maxWeight = row?.max_weight
    return typeof maxWeight === 'number' ? maxWeight : null
  }

  // PR baseline for one set: every earlier working set of the same exercise by this user,
  // ordered by (logged_at, rowid) so a replayed or edited set is compared only against what came
  // before it, never against itself or later sets. The rowid tiebreak matters because logged_at
  // only has second resolution -- several sets of one exercise routinely share a timestamp.
  async findWorkingSetsBefore(userId: string, exerciseId: string, setLogId: string): Promise<{ weightKg: number | null, reps: number | null }[]> {
    const result = await this.db.execute({
      sql: `SELECT sl.weight_kg, sl.reps
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN workout_sessions ws ON ws.id = el.session_id
            JOIN set_logs target ON target.id = ?
            WHERE ws.user_id = ? AND el.exercise_id = ? AND sl.is_warmup = 0
              AND (sl.logged_at, sl.rowid) < (target.logged_at, target.rowid)`,
      args: [setLogId, userId, exerciseId],
    })
    return result.rows.map(row => ({ weightKg: row.weight_kg as number | null, reps: row.reps as number | null }))
  }

  // One transaction: a past workout is written whole or not at all, never as a half-built
  // session a retry would then have to reconcile.
  async insertPastSession(userId: string, input: InsertPastSessionInput): Promise<void> {
    await this.db.batch([
      {
        sql: `INSERT INTO workout_sessions (id, user_id, split_day_id, status, started_at, completed_at, logged_retroactively)
              VALUES (?, ?, ?, 'completed', ?, ?, 1)`,
        args: [input.id, userId, input.splitDayId, input.startedAt, input.completedAt],
      },
      ...input.exercises.flatMap(exercise => [
        {
          sql: `INSERT INTO exercise_logs (id, session_id, exercise_id, split_exercise_id, position, set_type, target_sets, target_reps, target_reps_min, target_reps_max, target_rpe)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [exercise.id, input.id, exercise.exerciseId, exercise.splitExerciseId ?? null, exercise.position, exercise.setType,
            exercise.targetSets ?? null, ...repRangeArgs(exercise), exercise.targetRpe ?? null],
        },
        ...exercise.sets.map(set => ({
          sql: 'INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, logged_at) VALUES (?, ?, ?, ?, ?, ?)',
          args: [set.id, exercise.id, set.setNumber, set.weightKg, set.reps, set.loggedAt],
        })),
      ]),
    ], 'write')
  }

  // The counterpart of findWorkingSetsBefore: the sets whose PR baseline a backdated set just
  // joined, so their PRs can be re-detected. Same (logged_at, rowid) ordering.
  async findWorkingSetsAfter(userId: string, exerciseId: string, setLogId: string): Promise<SetLog[]> {
    const result = await this.db.execute({
      sql: `SELECT sl.*
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN workout_sessions ws ON ws.id = el.session_id
            JOIN set_logs target ON target.id = ?
            WHERE ws.user_id = ? AND el.exercise_id = ? AND sl.is_warmup = 0
              AND (sl.logged_at, sl.rowid) > (target.logged_at, target.rowid)
            ORDER BY sl.logged_at, sl.rowid`,
      args: [setLogId, userId, exerciseId],
    })
    return result.rows.map(row => this.mapSetLog(row as unknown as Record<string, unknown>))
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

  // Excludes warm-up sets from the top-set ranking, the sets_count and the per-set breakdown, so
  // a warm-up rep never becomes the displayed "last time" top set and doesn't inflate the set
  // count. `sets` keeps every working set in set order -- sets within one session are routinely
  // done at different weights (ramping, back-off sets), which the top set alone can't show.
  async findExerciseHistory(userId: string, exerciseId: string): Promise<ExerciseHistoryEntry[]> {
    const result = await this.db.execute({
      sql: `SELECT
              ws.id AS session_id,
              COALESCE(ws.completed_at, ws.started_at) AS session_date,
              sl.set_number AS set_number,
              sl.weight_kg AS weight_kg,
              sl.reps AS reps
            FROM workout_sessions ws
            JOIN exercise_logs el ON el.session_id = ws.id
            JOIN set_logs sl ON sl.exercise_log_id = el.id
            WHERE ws.user_id = ?
              AND el.exercise_id = ?
              AND sl.weight_kg IS NOT NULL
              AND sl.reps IS NOT NULL
              AND sl.is_warmup = 0
            ORDER BY session_date DESC, ws.id, sl.set_number`,
      args: [userId, exerciseId],
    })

    const bySession = new Map<string, ExerciseHistoryEntry>()
    for (const row of result.rows) {
      const sessionId = row.session_id as string
      const set = { setNumber: row.set_number as number, weightKg: row.weight_kg as number, reps: row.reps as number }
      const entry = bySession.get(sessionId)
      if (!entry) {
        bySession.set(sessionId, {
          sessionId,
          date: row.session_date as string,
          topSetWeightKg: set.weightKg,
          topSetReps: set.reps,
          setsCount: 1,
          sets: [set],
        })
        continue
      }
      entry.sets.push(set)
      entry.setsCount += 1
      const isHeavier = set.weightKg > entry.topSetWeightKg
        || (set.weightKg === entry.topSetWeightKg && set.reps > entry.topSetReps)
      if (isHeavier) {
        entry.topSetWeightKg = set.weightKg
        entry.topSetReps = set.reps
      }
    }
    return [...bySession.values()]
  }

  // Excludes warm-up sets: "last performed" should reflect the last real working set, not a
  // light warm-up rep that happens to be the most recent thing logged for the exercise.
  async findLastPerformedForExercises(userId: string, exerciseIds: string[]): Promise<Record<string, { weightKg: number, reps: number, date: string }>> {
    if (exerciseIds.length === 0) return {}
    const placeholders = exerciseIds.map(() => '?').join(', ')
    const result = await this.db.execute({
      sql: `WITH ranked_sets AS (
              SELECT
                el.exercise_id AS exercise_id,
                COALESCE(ws.completed_at, ws.started_at) AS session_date,
                sl.weight_kg AS weight_kg,
                sl.reps AS reps,
                ROW_NUMBER() OVER (
                  PARTITION BY el.exercise_id, ws.id
                  ORDER BY sl.weight_kg DESC, sl.reps DESC
                ) AS set_rank,
                DENSE_RANK() OVER (
                  PARTITION BY el.exercise_id
                  ORDER BY COALESCE(ws.completed_at, ws.started_at) DESC, ws.rowid DESC
                ) AS session_rank
              FROM workout_sessions ws
              JOIN exercise_logs el ON el.session_id = ws.id
              JOIN set_logs sl ON sl.exercise_log_id = el.id
              WHERE ws.user_id = ?
                AND el.exercise_id IN (${placeholders})
                AND sl.weight_kg IS NOT NULL
                AND sl.reps IS NOT NULL
                AND sl.is_warmup = 0
            )
            SELECT exercise_id, session_date, weight_kg, reps
            FROM ranked_sets
            WHERE set_rank = 1 AND session_rank = 1`,
      args: [userId, ...exerciseIds],
    })

    const byExercise: Record<string, { weightKg: number, reps: number, date: string }> = {}
    for (const row of result.rows) {
      const r = row as unknown as Record<string, unknown>
      byExercise[r.exercise_id as string] = {
        weightKg: r.weight_kg as number,
        reps: r.reps as number,
        date: r.session_date as string,
      }
    }
    return byExercise
  }

  // Progression input: every working set of the `sessions` most recent *completed* sessions that
  // contain this exercise, grouped per session, newest first. Separate from findExerciseHistory
  // because progression autoregulates on RPE (which that query doesn't select) and must ignore
  // the in-progress session it's suggesting for -- findExerciseHistory deliberately includes the
  // live session so the session page can show a "last time" hint mid-workout.
  async findRecentWorkingSets(userId: string, exerciseId: string, sessions: number): Promise<WorkingSet[][]> {
    const result = await this.db.execute({
      sql: `WITH recent AS (
              SELECT DISTINCT
                ws.id AS id,
                COALESCE(ws.completed_at, ws.started_at) AS session_date,
                ws.rowid AS session_rowid
              FROM workout_sessions ws
              JOIN exercise_logs el ON el.session_id = ws.id
              WHERE ws.user_id = ? AND el.exercise_id = ? AND ws.status = 'completed'
              ORDER BY session_date DESC, session_rowid DESC
              LIMIT ?
            )
            SELECT recent.id AS session_id, sl.weight_kg, sl.reps, sl.rpe
            FROM recent
            JOIN exercise_logs el ON el.session_id = recent.id AND el.exercise_id = ?
            JOIN set_logs sl ON sl.exercise_log_id = el.id
            WHERE sl.is_warmup = 0
            ORDER BY recent.session_date DESC, recent.session_rowid DESC, sl.set_number`,
      args: [userId, exerciseId, sessions, exerciseId],
    })

    const bySession = new Map<string, WorkingSet[]>()
    for (const row of result.rows) {
      const r = row as unknown as Record<string, unknown>
      const sessionId = r.session_id as string
      const sets = bySession.get(sessionId) ?? []
      sets.push({ weightKg: r.weight_kg as number | null, reps: r.reps as number | null, rpe: r.rpe as number | null })
      bySession.set(sessionId, sets)
    }
    return [...bySession.values()]
  }

  async countTrainedDaysInRange(userId: string, startIso: string, endIso: string): Promise<number> {
    const result = await this.db.execute({
      sql: `SELECT COUNT(DISTINCT date(started_at)) as count FROM workout_sessions
            WHERE user_id = ? AND status = 'completed' AND started_at >= ? AND started_at < ?`,
      args: [userId, startIso, endIso],
    })
    return (result.rows[0]?.count as number) ?? 0
  }

  // Keyed by the week's Monday (UTC), matching startOfWeek in server/utils/date.ts:
  // date(x, 'weekday 0') moves forward to Sunday (or stays put on one), then -6 days lands on
  // that week's Monday. Distinct days, not sessions, so two workouts in a day count once.
  async completedDaysByWeek(userId: string): Promise<Record<string, number>> {
    const result = await this.db.execute({
      sql: `SELECT date(started_at, 'weekday 0', '-6 days') AS week_start, COUNT(DISTINCT date(started_at)) AS days
            FROM workout_sessions
            WHERE user_id = ? AND status = 'completed'
            GROUP BY week_start`,
      args: [userId],
    })
    return Object.fromEntries(result.rows.map(row => [row.week_start as string, row.days as number]))
  }

  async findTrainedDatesInRange(userId: string, startIso: string, endIso: string): Promise<Set<string>> {
    const result = await this.db.execute({
      sql: `SELECT DISTINCT date(started_at) as day FROM workout_sessions
            WHERE user_id = ? AND status = 'completed' AND started_at >= ? AND started_at < ?`,
      args: [userId, startIso, endIso],
    })
    return new Set(result.rows.map(row => (row as unknown as Record<string, unknown>).day as string))
  }

  // Decision: NOT excluding warm-ups here (unlike weeklySetsByMuscle below). This is the
  // lifetime total feeding the total_volume_kg achievement, which rewards cumulative work done
  // over months, not a snapshot of a single week's training stress — a warm-up rep is real
  // weight actually moved, and its contribution here is negligible next to working sets, so the
  // simpler "count everything logged" semantics are preferable to adding another filter.
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

  // Session-scoped counterpart to volumeKgInRange: same warm-up exclusion (a warm-up rep isn't
  // real training stress and shouldn't inflate the number shown), but scoped to one session
  // rather than a date range. Feeds the post-workout summary's total-volume figure.
  async sessionVolumeKg(sessionId: string): Promise<number> {
    const result = await this.db.execute({
      sql: `SELECT COALESCE(SUM(sl.weight_kg * sl.reps), 0) AS total
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            WHERE el.session_id = ? AND sl.weight_kg IS NOT NULL AND sl.reps IS NOT NULL AND sl.is_warmup = 0`,
      args: [sessionId],
    })
    return (result.rows[0]?.total as number) ?? 0
  }

  // Decision: excludes warm-ups (sl.is_warmup = 0), consistent with weeklySetsByMuscle below —
  // this feeds home's weekly-volume display, the same "this week's real training stress" concept,
  // as opposed to totalVolumeKg's lifetime achievement total which intentionally counts everything.
  async volumeKgInRange(userId: string, startIso: string, endIso: string): Promise<number> {
    const result = await this.db.execute({
      sql: `SELECT COALESCE(SUM(sl.weight_kg * sl.reps), 0) AS total
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN workout_sessions ws ON ws.id = el.session_id
            WHERE ws.user_id = ? AND sl.weight_kg IS NOT NULL AND sl.reps IS NOT NULL AND sl.is_warmup = 0
              AND ws.started_at >= ? AND ws.started_at < ?`,
      args: [userId, startIso, endIso],
    })
    return (result.rows[0]?.total as number) ?? 0
  }

  // Assumes every logged exercise has at least one primary-muscle row in exercise_muscles;
  // sets against an untagged exercise are silently excluded from every muscle's count.
  //
  // Decision: warm-up sets are excluded here too (sl.is_warmup = 0). This weekly count exists
  // to flag under/over-trained muscles from real training stress — a handful of light warm-up
  // reps isn't the stress the low/optimal/high bands are meant to measure, and counting them
  // would let someone appear to be hitting volume targets on warm-ups alone.
  async weeklySetsByMuscle(userId: string, startIso: string, endIso: string): Promise<{ muscleId: number, muscleName: string, setCount: number }[]> {
    const result = await this.db.execute({
      sql: `SELECT muscles.id AS muscle_id, muscles.name AS muscle_name, COUNT(DISTINCT sl.id) AS set_count
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN workout_sessions ws ON ws.id = el.session_id
            JOIN exercise_muscles em ON em.exercise_id = el.exercise_id AND em.role = 'primary'
            JOIN muscles ON muscles.id = em.muscle_id
            WHERE ws.user_id = ? AND sl.logged_at >= ? AND sl.logged_at < ? AND sl.is_warmup = 0
            GROUP BY muscles.id
            ORDER BY set_count DESC`,
      args: [userId, startIso, endIso],
    })
    return result.rows.map((row) => {
      const r = row as unknown as Record<string, unknown>
      return { muscleId: r.muscle_id as number, muscleName: r.muscle_name as string, setCount: r.set_count as number }
    })
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

  async findRecentCompletedSummaries(userId: string, limit: number): Promise<RecentSessionSummary[]> {
    const sessionResult = await this.db.execute({
      sql: `SELECT workout_sessions.*, split_days.name AS day_name,
                   CASE WHEN logged_retroactively = 1 THEN NULL
                        ELSE ROUND((julianday(completed_at) - julianday(started_at)) * 24 * 60) END AS duration_minutes
            FROM workout_sessions
            LEFT JOIN split_days ON split_days.id = workout_sessions.split_day_id
            WHERE workout_sessions.user_id = ? AND workout_sessions.status = 'completed'
            ORDER BY completed_at DESC, workout_sessions.rowid DESC LIMIT ?`,
      args: [userId, limit],
    })

    return Promise.all(sessionResult.rows.map(async (row) => {
      const sessionRow = row as unknown as Record<string, unknown>
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
        dayName: (sessionRow.day_name as string) ?? null,
        startedAt: sessionRow.started_at as string,
        completedAt: sessionRow.completed_at as string,
        durationMinutes: sessionRow.duration_minutes as number | null,
        loggedRetroactively: Boolean(sessionRow.logged_retroactively),
        topExerciseName: (topSetRow?.exercise_name as string) ?? null,
        topWeightKg: (topSetRow?.weight_kg as number) ?? null,
        topReps: (topSetRow?.reps as number) ?? null,
      }
    }))
  }

  async findMostRecentCompletedSummary(userId: string): Promise<RecentSessionSummary | null> {
    const [summary] = await this.findRecentCompletedSummaries(userId, 1)
    return summary ?? null
  }
}
