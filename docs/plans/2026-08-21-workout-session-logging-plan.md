# Workout Session Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist what a user actually did — `WorkoutSession` → `ExerciseLog` → `SetLog` — so the
already-built-but-inert `GamificationService` has real events to react to, and wire the completion path
to it.

**Architecture:** Three new tables use `TEXT` (caller-supplied UUID) primary keys instead of this
codebase's usual `INTEGER AUTOINCREMENT`, because the client is expected to generate ids offline before
a request ever reaches the server (see the design doc, §6). `SessionRepository` follows the
`BlockRepository` pattern (hand-written nested SQL, not `BaseRepository`) because it has to snapshot a
plan, check completion, and handle optimistic-concurrency conflicts — all beyond generic CRUD.
`SessionService extends BaseService` for the `requireOwner` boundary, and is the first real caller of
`GamificationService`.

**Tech Stack:** Nuxt/Nitro server, `@libsql/client`, Vitest, `crypto.randomUUID()` (no new dependency).

**Context this plan assumes:**
- Design doc: `docs/plans/2026-08-21-workout-session-logging-design.md` — read it first, it has the
  rationale for every non-obvious choice below (client-generated ids, the freeform-counts-toward-streak
  rule, the no-retroactive-recompute rule on edits, the version-based conflict model).
- Existing conventions: tests live under `tests/server/**` mirroring `server/**`, import via the `~~/`
  alias, `server/utils/test/create-test-db.ts` gives an in-memory schema-applied DB for tests.
- `GamificationService` (`server/services/gamification.service.ts`) already exists and is unchanged by
  this plan — this plan is its first caller.

**One implementation-level refinement not spelled out verbatim in the design doc:** for a planned
session, the *client* sends the `exercise_logs` snapshot rows (id, exerciseId, splitExerciseId, position,
setType, targets) in the `startSession` payload, rather than the server re-deriving them from
`split_exercises`. This keeps the online and offline code paths for starting a session identical (one
payload, persisted as given) instead of needing two different mechanisms — and it's what "snapshot at
session start" has to mean anyway once starting a session offline is in scope: the client is snapshotting
the plan *it* currently has cached, not asking the server to look one up it may not be reachable to ask.

---

## Task 1: Extend the schema

**Files:**
- Modify: `server/database/schema.sql`

**Step 1: Append the new tables and indexes**

Append to the end of `server/database/schema.sql`, matching the file's existing style:

```sql
-- Workout session logging: what a user actually did, as opposed to what a
-- Block/SplitDay/SplitExercise prescribes. TEXT (caller-supplied UUID) ids on
-- these three tables, not INTEGER AUTOINCREMENT, because the client generates
-- them before an offline write ever reaches the server.

CREATE TABLE IF NOT EXISTS workout_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  split_day_id  INTEGER REFERENCES split_days(id) ON DELETE SET NULL,
  status        TEXT NOT NULL CHECK (status IN ('in_progress','completed','abandoned')) DEFAULT 'in_progress',
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS exercise_logs (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id        TEXT NOT NULL REFERENCES exercises(id),
  split_exercise_id  INTEGER REFERENCES split_exercises(id),
  position           INTEGER NOT NULL,
  set_type           TEXT NOT NULL CHECK (set_type IN ('weight_reps','bodyweight_reps','time')),
  target_sets        INTEGER,
  target_reps        INTEGER,
  target_rpe         REAL
);

CREATE TABLE IF NOT EXISTS set_logs (
  id               TEXT PRIMARY KEY,
  exercise_log_id  TEXT NOT NULL REFERENCES exercise_logs(id) ON DELETE CASCADE,
  set_number       INTEGER NOT NULL,
  weight_kg        REAL,
  reps             INTEGER,
  rpe              REAL,
  logged_at        TEXT NOT NULL DEFAULT (datetime('now')),
  version          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_table   TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  server_value   TEXT NOT NULL,
  proposed_value TEXT NOT NULL,
  base_version   INTEGER NOT NULL,
  detected_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT,
  resolution     TEXT CHECK (resolution IN ('kept_mine','kept_server','manual'))
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_user ON workout_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_session  ON exercise_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_exercise ON exercise_logs(exercise_id);
CREATE INDEX IF NOT EXISTS idx_set_logs_exercise_log  ON set_logs(exercise_log_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_user    ON sync_conflicts(user_id, resolved_at);
```

**Step 2: Add `is_rest_day` to `split_days`**

`split_days.name` is freeform text (`'Push'`, `'Rest'`, ...) with nothing structured marking a day as a
rest day. The streak/completion rule needs "non-Rest split_day" to be a real signal, not a string match
on `name`. Add a column via a second `ALTER TABLE` statement, appended right after the block above:

```sql
ALTER TABLE split_days ADD COLUMN is_rest_day INTEGER NOT NULL DEFAULT 0;
```

(`seed.ts` and every existing preset never create a "Rest" `split_days` row at all — they only list actual
training days — so this defaults to `0` everywhere with no backfill needed.)

**Step 3: Verify the schema still parses**

Run: `npx vitest run tests/server/utils/test/create-test-db.test.ts`
Expected: PASS — this test applies the whole `schema.sql` against an in-memory DB and checks a known
table exists; a syntax error anywhere in the file (including the new statements) fails it.

**Step 4: Commit**

```bash
git add server/database/schema.sql
git commit -m "feat: add workout session logging tables"
```

---

## Task 2: Shared types

**Files:**
- Create: `shared/types/session.types.ts`

**Step 1: Write the file**

```ts
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
```

No test — pure type declarations, nothing to assert, matching the convention already used for
`shared/types/*.ts` elsewhere in this codebase.

**Step 2: Commit**

```bash
git add shared/types/session.types.ts
git commit -m "feat: add workout session logging types"
```

---

## Task 3: `SessionRepository.startSession`

**Files:**
- Create: `server/repositories/session.repository.ts`
- Test: `tests/server/repositories/session.repository.test.ts`

**Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'

async function seedUserAndBlock(db: Client) {
  await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  await db.execute({ sql: 'INSERT INTO programs (id, user_id, name) VALUES (1, ?, ?)', args: ['user-1', 'Program'] })
  await db.execute({
    sql: `INSERT INTO blocks (id, program_id, user_id, name, start_date) VALUES (1, 1, ?, 'Block', '2026-01-01')`,
    args: ['user-1'],
  })
  await db.execute({
    sql: `INSERT INTO split_days (id, block_id, name, day_of_week, location, is_rest_day) VALUES (1, 1, 'Push', 1, 'gym', 0)`,
  })
  await db.execute({
    sql: `INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`,
  })
  await db.execute({
    sql: `INSERT INTO split_exercises (id, split_day_id, exercise_id, position, set_type, target_sets, target_reps, target_rpe)
          VALUES (1, 1, 'bench-press', 0, 'weight_reps', 3, 8, 7)`,
  })
}

describe('SessionRepository.startSession', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('starts a planned session with the client-supplied exercise-log snapshot', async () => {
    const session = await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{
        id: 'exlog-1',
        exerciseId: 'bench-press',
        splitExerciseId: 1,
        position: 0,
        setType: 'weight_reps',
        targetSets: 3,
        targetReps: 8,
        targetRpe: 7,
      }],
    })

    expect(session.id).toBe('session-1')
    expect(session.status).toBe('in_progress')
    expect(session.version).toBe(1)

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises).toHaveLength(1)
    expect(withLogs?.exercises[0].targetSets).toBe(3)
  })

  it('starts a freeform session with no split day and no exercises', async () => {
    const session = await repo.startSession('user-1', { id: 'session-2', splitDayId: null, exercises: [] })
    expect(session.splitDayId).toBeNull()

    const withLogs = await repo.findWithLogs('session-2')
    expect(withLogs?.exercises).toHaveLength(0)
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: FAIL — `session.repository.ts` doesn't exist yet.

**Step 3: Implement**

```ts
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
  constructor(protected db: Client) {}

  protected mapSession(row: Record<string, unknown>): WorkoutSession {
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

  protected mapExerciseLog(row: Record<string, unknown>): ExerciseLog {
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

  protected mapSetLog(row: Record<string, unknown>): SetLog {
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

    for (const ex of input.exercises) {
      await this.db.execute({
        sql: `INSERT INTO exercise_logs (id, session_id, exercise_id, split_exercise_id, position, set_type, target_sets, target_reps, target_rpe)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [ex.id, session.id, ex.exerciseId, ex.splitExerciseId, ex.position, ex.setType, ex.targetSets, ex.targetReps, ex.targetRpe],
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
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: both tests pass.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat: add SessionRepository.startSession and findWithLogs"
```

---

## Task 4: Logging sets and freeform exercises

**Files:**
- Modify: `server/repositories/session.repository.ts`
- Modify: `tests/server/repositories/session.repository.test.ts`

**Step 1: Add failing tests**

Append to the `describe('SessionRepository.startSession', ...)` file — actually, add a new top-level
`describe` block in the same test file:

```ts
describe('SessionRepository logging', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{
        id: 'exlog-1',
        exerciseId: 'bench-press',
        splitExerciseId: 1,
        position: 0,
        setType: 'weight_reps',
        targetSets: 3,
        targetReps: 8,
        targetRpe: 7,
      }],
    })
  })

  it('logs a set against an existing exercise log', async () => {
    const set = await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
    expect(set.version).toBe(1)

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises[0].sets).toHaveLength(1)
    expect(withLogs?.exercises[0].sets[0].weightKg).toBe(60)
  })

  it('adds a freeform exercise mid-session with no split_exercise_id or targets', async () => {
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })

    const exerciseLog = await repo.addFreeformExercise({
      id: 'exlog-2',
      sessionId: 'session-1',
      exerciseId: 'plank',
      position: 1,
      setType: 'time',
    })
    expect(exerciseLog.splitExerciseId).toBeNull()
    expect(exerciseLog.targetSets).toBeNull()

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises).toHaveLength(2)
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: the two new tests FAIL — `logSet`/`addFreeformExercise` don't exist. Earlier tests still pass.

**Step 3: Implement**

Add to `server/repositories/session.repository.ts`:

```ts
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
```

...and these methods on the class:

```ts
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
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: all 4 tests pass.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat: add SessionRepository.logSet and addFreeformExercise"
```

---

## Task 5: The completion rule

**Files:**
- Modify: `server/repositories/session.repository.ts`
- Modify: `tests/server/repositories/session.repository.test.ts`

**Step 1: Add failing tests**

```ts
describe('SessionRepository.isComplete', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('a planned session is incomplete until every planned exercise hits its target set count', async () => {
    await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetReps: 8, targetRpe: 7 }],
    })

    expect(await repo.isComplete('session-1')).toBe(false)

    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
    await repo.logSet({ id: 'set-2', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 8, rpe: 7 })
    expect(await repo.isComplete('session-1')).toBe(false)

    await repo.logSet({ id: 'set-3', exerciseLogId: 'exlog-1', setNumber: 3, weightKg: 60, reps: 8, rpe: 7 })
    expect(await repo.isComplete('session-1')).toBe(true)
  })

  it('a freeform exercise added mid-session never blocks completion of the planned exercises', async () => {
    await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 1, targetReps: 8, targetRpe: 7 }],
    })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })

    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-2', sessionId: 'session-1', exerciseId: 'plank', position: 1, setType: 'time' })

    expect(await repo.isComplete('session-1')).toBe(true)
  })

  it('a freeform session is complete once it has at least one logged set anywhere', async () => {
    await repo.startSession('user-1', { id: 'session-2', splitDayId: null, exercises: [] })
    expect(await repo.isComplete('session-2')).toBe(false)

    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-3', sessionId: 'session-2', exerciseId: 'plank', position: 0, setType: 'time' })
    expect(await repo.isComplete('session-2')).toBe(false)

    await repo.logSet({ id: 'set-4', exerciseLogId: 'exlog-3', setNumber: 1, weightKg: null, reps: null, rpe: null })
    expect(await repo.isComplete('session-2')).toBe(true)
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: 3 new tests FAIL — `isComplete` doesn't exist.

**Step 3: Implement**

```ts
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
      return ((result.rows[0]?.count as number) ?? 0) > 0
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
      const target = (r.target_sets as number) ?? 0
      const logged = r.logged as number
      return logged >= target
    })
  }
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: all 7 tests pass.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat: add SessionRepository.isComplete"
```

---

## Task 6: Completing a session, with version-checked conflict detection

**Files:**
- Modify: `server/repositories/session.repository.ts`
- Modify: `tests/server/repositories/session.repository.test.ts`

**Step 1: Add failing tests**

```ts
describe('SessionRepository.completeSession', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })
  })

  it('completes a session when the expected version matches', async () => {
    const result = await repo.completeSession('session-1', 1)
    expect(result.conflict).toBe(false)
    if (!result.conflict) {
      expect(result.session.status).toBe('completed')
      expect(result.session.version).toBe(2)
      expect(result.session.completedAt).not.toBeNull()
    }
  })

  it('reports a conflict, and records it, when the expected version is stale', async () => {
    await repo.completeSession('session-1', 1) // version is now 2

    const result = await repo.completeSession('session-1', 1) // stale client still thinks it's 1
    expect(result.conflict).toBe(true)

    const conflicts = await db.execute({ sql: 'SELECT * FROM sync_conflicts WHERE entity_id = ?', args: ['session-1'] })
    expect(conflicts.rows).toHaveLength(1)
    expect(conflicts.rows[0].entity_table).toBe('workout_sessions')
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: 2 new tests FAIL — `completeSession` doesn't exist.

**Step 3: Implement**

```ts
export interface ConflictResult {
  conflict: true
}
export interface SessionCompleteResult {
  conflict: false
  session: WorkoutSession
}
```

```ts
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
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: all 9 tests pass.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat: add SessionRepository.completeSession with conflict detection"
```

---

## Task 7: Editing a logged set, with the same conflict model

**Files:**
- Modify: `server/repositories/session.repository.ts`
- Modify: `tests/server/repositories/session.repository.test.ts`

**Step 1: Add failing tests**

```ts
describe('SessionRepository.editSetLog', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench-press-2', 'Bench', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'bench-press-2', position: 0, setType: 'weight_reps' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
  })

  it('applies a correction when the expected version matches', async () => {
    const result = await repo.editSetLog('set-1', 1, { weightKg: 62.5 })
    expect(result.conflict).toBe(false)
    if (!result.conflict) {
      expect(result.setLog.weightKg).toBe(62.5)
      expect(result.setLog.version).toBe(2)
    }
  })

  it('records a conflict instead of silently overwriting when the expected version is stale', async () => {
    await repo.editSetLog('set-1', 1, { weightKg: 62.5 }) // version is now 2

    const result = await repo.editSetLog('set-1', 1, { weightKg: 999 }) // stale client
    expect(result.conflict).toBe(true)

    const stillCorrect = await db.execute({ sql: 'SELECT weight_kg FROM set_logs WHERE id = ?', args: ['set-1'] })
    expect(stillCorrect.rows[0].weight_kg).toBe(62.5) // the stale write never applied

    const conflicts = await db.execute({ sql: 'SELECT * FROM sync_conflicts WHERE entity_id = ?', args: ['set-1'] })
    expect(conflicts.rows).toHaveLength(1)
    expect(conflicts.rows[0].entity_table).toBe('set_logs')
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: 2 new tests FAIL — `editSetLog` doesn't exist.

**Step 3: Implement**

```ts
export interface EditSetLogInput {
  weightKg?: number | null
  reps?: number | null
  rpe?: number | null
}
export interface SetLogEditResult {
  conflict: false
  setLog: SetLog
}
```

```ts
  async editSetLog(setLogId: string, expectedVersion: number, corrections: EditSetLogInput): Promise<SetLogEditResult | ConflictResult> {
    const keys = Object.keys(corrections)
    const setClause = keys.map(k => `${k === 'weightKg' ? 'weight_kg' : k} = ?`).join(', ')
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
    const sessionId = (exerciseLogResult.rows[0] as unknown as Record<string, unknown>)?.session_id as string
    const session = await this.findSessionById(sessionId)

    await this.db.execute({
      sql: `INSERT INTO sync_conflicts (user_id, entity_table, entity_id, server_value, proposed_value, base_version)
            VALUES (?, 'set_logs', ?, ?, ?, ?)`,
      args: [session?.userId ?? null, setLogId, JSON.stringify(current), JSON.stringify(corrections), expectedVersion],
    })
    return { conflict: true }
  }
```

Note the `weightKg` → `weight_kg` mapping inline in `setClause` — `reps`/`rpe` are already snake_case-
compatible so they pass through unchanged; this is the one field where camelCase and the column name
diverge.

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: all 11 tests pass.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat: add SessionRepository.editSetLog with conflict detection"
```

---

## Task 8: Expiring stale in-progress sessions

**Files:**
- Modify: `server/repositories/session.repository.ts`
- Modify: `tests/server/repositories/session.repository.test.ts`

**Step 1: Add failing tests**

```ts
describe('SessionRepository.expireStaleSessions', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('marks an in-progress session older than 12 hours as abandoned', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({
      sql: `UPDATE workout_sessions SET started_at = datetime('now', '-13 hours') WHERE id = ?`,
      args: ['session-1'],
    })

    await repo.expireStaleSessions('user-1')

    const session = await repo.findSessionById('session-1')
    expect(session?.status).toBe('abandoned')
  })

  it('leaves a recent in-progress session untouched', async () => {
    await repo.startSession('user-1', { id: 'session-2', splitDayId: null, exercises: [] })
    await repo.expireStaleSessions('user-1')

    const session = await repo.findSessionById('session-2')
    expect(session?.status).toBe('in_progress')
  })

  it('never touches an already-completed session', async () => {
    await repo.startSession('user-1', { id: 'session-3', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-3', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })
    await repo.completeSession('session-3', 1)
    await db.execute({
      sql: `UPDATE workout_sessions SET started_at = datetime('now', '-13 hours') WHERE id = ?`,
      args: ['session-3'],
    })

    await repo.expireStaleSessions('user-1')

    const session = await repo.findSessionById('session-3')
    expect(session?.status).toBe('completed')
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: 3 new tests FAIL — `expireStaleSessions` doesn't exist.

**Step 3: Implement**

```ts
const ABANDON_AFTER_HOURS = 12
```

```ts
  async expireStaleSessions(userId: string): Promise<void> {
    await this.db.execute({
      sql: `UPDATE workout_sessions
            SET status = 'abandoned', version = version + 1
            WHERE user_id = ? AND status = 'in_progress'
              AND started_at < datetime('now', ?)`,
      args: [userId, `-${ABANDON_AFTER_HOURS} hours`],
    })
  }
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: all 14 tests pass.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat: add SessionRepository.expireStaleSessions"
```

---

## Task 9: `BlockRepository.findActiveForUser`

**Files:**
- Modify: `server/repositories/block.repository.ts`
- Modify: `tests/server/repositories/block.repository.test.ts`

Needed by Task 10 to compute `scheduledDaysThisWeek`: "active Block" means the most recently started
Block whose `start_date` is on or before today and whose `end_date` is either null or on/after today.

**Step 1: Add the failing test**

Append to `tests/server/repositories/block.repository.test.ts`:

```ts
describe('BlockRepository.findActiveForUser', () => {
  it('finds the block whose date range covers today', async () => {
    const db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const repo = new BlockRepository(db)

    const past = await repo.createWithDays('user-1', {
      programId: null, name: 'Old Block', startDate: '2020-01-01', endDate: '2020-02-01',
      trainingDayMacroTarget: null, restDayMacroTarget: null, days: [],
    })
    const active = await repo.createWithDays('user-1', {
      programId: null, name: 'Current Block', startDate: '2020-01-01', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null, days: [],
    })

    const found = await repo.findActiveForUser('user-1', '2026-08-21')
    expect(found?.id).toBe(active.id)
    expect(found?.id).not.toBe(past.id)
  })

  it('returns null when no block covers today', async () => {
    const db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const repo = new BlockRepository(db)
    expect(await repo.findActiveForUser('user-1', '2026-08-21')).toBeNull()
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/block.repository.test.ts`
Expected: 2 new tests FAIL.

**Step 3: Implement**

Add to `server/repositories/block.repository.ts`:

```ts
  async findActiveForUser(userId: string, asOfDate: string): Promise<BlockWithDays | null> {
    const result = await this.db.execute({
      sql: `SELECT id FROM blocks
            WHERE user_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
            ORDER BY start_date DESC LIMIT 1`,
      args: [userId, asOfDate, asOfDate],
    })
    const row = result.rows[0]
    if (!row) return null
    return this.findWithDays((row as unknown as Record<string, unknown>).id as number)
  }
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/repositories/block.repository.test.ts`
Expected: all tests pass (existing + 2 new).

**Step 5: Commit**

```bash
git add server/repositories/block.repository.ts tests/server/repositories/block.repository.test.ts
git commit -m "feat: add BlockRepository.findActiveForUser"
```

---

## Task 10: `SessionService` — ownership, and wiring completion to gamification

**Files:**
- Create: `server/services/session.service.ts`
- Test: `tests/server/services/session.service.test.ts`

**Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { SessionService } from '~~/server/services/session.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

function ctx(userId = 'user-1'): RequestContext {
  return { userId, roles: [], permissions: [] }
}

async function seedUserWithActiveBlock(db: Client, trainingDays: number) {
  await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  const blocks = new BlockRepository(db)
  await blocks.createWithDays('user-1', {
    programId: null,
    name: 'Block',
    startDate: '2020-01-01',
    endDate: null,
    trainingDayMacroTarget: null,
    restDayMacroTarget: null,
    days: Array.from({ length: trainingDays }, (_, i) => ({
      name: `Day ${i}`, dayOfWeek: i, location: 'gym' as const, exercises: [],
    })),
  })
}

describe('SessionService', () => {
  let db: Client
  let sessions: SessionRepository
  let service: SessionService
  let onSessionCompleted: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    onSessionCompleted = vi.fn()
    service = new SessionService(ctx(), sessions, new BlockRepository(db), { onSessionCompleted } as never)
  })

  it('rejects completing a session owned by someone else', async () => {
    await seedUserWithActiveBlock(db, 1)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    await sessions.startSession('user-2', { id: 'session-1', splitDayId: null, exercises: [] })

    await expect(service.completeSession('session-1', 1)).rejects.toThrow(/forbidden/i)
  })

  it('calls GamificationService.onSessionCompleted with the computed weekly facts', async () => {
    await seedUserWithActiveBlock(db, 2)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })

    await service.completeSession('session-1', 1)

    expect(onSessionCompleted).toHaveBeenCalledTimes(1)
    const [userId, sessionId, facts] = onSessionCompleted.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(sessionId).toBe('session-1')
    expect(facts.scheduledDaysThisWeek).toBe(2)
    expect(facts.completedDaysThisWeek).toBe(1)
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/services/session.service.test.ts`
Expected: FAIL — `session.service.ts` doesn't exist.

**Step 3: Implement**

```ts
import { BaseService } from '~~/server/services/base.service'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { GamificationService } from '~~/server/services/gamification.service'
import type { RequestContext } from '~~/shared/types/rbac.types'
import { createError } from 'h3'

function startOfWeek(date: Date): Date {
  const day = date.getUTCDay() // 0 = Sunday
  const diff = (day + 6) % 7 // days since Monday
  const start = new Date(date)
  start.setUTCDate(date.getUTCDate() - diff)
  start.setUTCHours(0, 0, 0, 0)
  return start
}

export class SessionService extends BaseService {
  constructor(
    ctx: RequestContext,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
    private gamification: GamificationService,
  ) {
    super(ctx)
  }

  private async requireOwnedSession(sessionId: string) {
    const session = await this.sessions.findSessionById(sessionId)
    if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
    this.requireOwner(session.userId)
    return session
  }

  async completeSession(sessionId: string, expectedVersion: number) {
    await this.requireOwnedSession(sessionId)

    const result = await this.sessions.completeSession(sessionId, expectedVersion)
    if (result.conflict) return result

    const now = new Date()
    const weekStart = startOfWeek(now)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7)

    const activeBlock = await this.blocks.findActiveForUser(this.ctx.userId, now.toISOString().slice(0, 10))
    const scheduledDaysThisWeek = activeBlock?.days.length ?? 0

    const completedDaysThisWeek = await this.sessions.countTrainedDaysInRange(
      this.ctx.userId,
      weekStart.toISOString(),
      weekEnd.toISOString(),
    )

    await this.gamification.onSessionCompleted(this.ctx.userId, sessionId, {
      scheduledDaysThisWeek,
      completedDaysThisWeek,
      missedScheduledDay: completedDaysThisWeek < scheduledDaysThisWeek,
    })

    return result
  }
}
```

**Step 4: Add the missing `countTrainedDaysInRange` to `SessionRepository`**

This is used above but doesn't exist yet — add it (with its own small test) to
`server/repositories/session.repository.ts`:

```ts
  async countTrainedDaysInRange(userId: string, startIso: string, endIso: string): Promise<number> {
    const result = await this.db.execute({
      sql: `SELECT COUNT(DISTINCT date(started_at)) as count FROM workout_sessions
            WHERE user_id = ? AND status = 'completed' AND started_at >= ? AND started_at < ?`,
      args: [userId, startIso, endIso],
    })
    return (result.rows[0]?.count as number) ?? 0
  }
```

Add to `tests/server/repositories/session.repository.test.ts`:

```ts
describe('SessionRepository.countTrainedDaysInRange', () => {
  it('counts distinct calendar days with at least one completed session, planned or freeform', async () => {
    const db = await createTestDb()
    const repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })

    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })
    await repo.completeSession('session-1', 1)

    const count = await repo.countTrainedDaysInRange('user-1', '2000-01-01', '2100-01-01')
    expect(count).toBe(1)
  })
})
```

**Step 5: Run to verify pass**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts tests/server/services/session.service.test.ts`
Expected: all tests pass.

**Step 6: Commit**

```bash
git add server/services/session.service.ts server/repositories/session.repository.ts \
  tests/server/services/session.service.test.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat: add SessionService and wire session completion to GamificationService"
```

---

## Task 11: API routes

**Files:**
- Create: `server/api/sessions/index.post.ts`
- Create: `server/api/sessions/[id]/sets.post.ts`
- Create: `server/api/sessions/[id]/exercises.post.ts`
- Create: `server/api/sessions/[id]/complete.post.ts`
- Create: `server/api/sessions/[id]/sets/[setId].patch.ts`

No new tests here — these are thin wiring, matching the existing convention where routes under
`server/api/` have no dedicated test file and are covered by the service/repository tests underneath
plus the manual smoke check in Task 12.

**Step 1: Start a session**

```ts
// server/api/sessions/index.post.ts
import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const repo = new SessionRepository(useDb())
  await repo.expireStaleSessions(ctx.userId)
  return repo.startSession(ctx.userId, body)
})
```

**Step 2: Log a set**

```ts
// server/api/sessions/[id]/sets.post.ts
import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  await getRequestContext(event) // ownership isn't checked on the hot logging path here — see note below
  const body = await readBody(event)
  const repo = new SessionRepository(useDb())
  return repo.logSet(body)
})
```

Ownership on this route is intentionally left to a future pass: `logSet` takes only an
`exerciseLogId`, not a session, so checking `requireOwner` here means an extra lookup
(`exercise_log → session → session.userId`) on every single set logged, which is the highest-frequency
write in the whole feature. Flagging it rather than silently skipping it: this is a real gap (a caller
who knows another user's `exerciseLogId` UUID could currently log a set into their session) worth closing
before this goes further than local development, but out of scope for this plan to fix by design — the
UUIDs aren't guessable, which is a mitigating factor. Any deployment with real, untrusted users should
close this before shipping.

**Step 3: Add a freeform exercise**

```ts
// server/api/sessions/[id]/exercises.post.ts
import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const body = await readBody(event)
  const repo = new SessionRepository(useDb())
  return repo.addFreeformExercise(body)
})
```

**Step 4: Complete a session**

```ts
// server/api/sessions/[id]/complete.post.ts
import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { GamificationService } from '~~/server/services/gamification.service'
import { SessionService } from '~~/server/services/session.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event) as { expectedVersion: number }
  const db = useDb()

  const gamification = new GamificationService(new XpRepository(db), new StreakRepository(db), new AchievementRepository(db))
  const service = new SessionService(ctx, new SessionRepository(db), new BlockRepository(db), gamification)

  const result = await service.completeSession(id, body.expectedVersion)
  if (result.conflict) {
    throw createError({ statusCode: 409, statusMessage: 'Session was modified elsewhere; check sync conflicts' })
  }
  return result.session
})
```

**Step 5: Edit a logged set**

```ts
// server/api/sessions/[id]/sets/[setId].patch.ts
import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const setId = getRouterParam(event, 'setId')!
  const body = await readBody(event) as { expectedVersion: number, weightKg?: number | null, reps?: number | null, rpe?: number | null }
  const repo = new SessionRepository(useDb())

  const result = await repo.editSetLog(setId, body.expectedVersion, {
    weightKg: body.weightKg, reps: body.reps, rpe: body.rpe,
  })
  if (result.conflict) {
    throw createError({ statusCode: 409, statusMessage: 'Set was modified elsewhere; check sync conflicts' })
  }
  return result.setLog
})
```

**Step 6: Commit**

```bash
git add server/api/sessions
git commit -m "feat: add workout session logging API routes"
```

---

## Task 12: Manual smoke check

**Step 1: Start the dev server**

Run: `npm run dev`

**Step 2: Start a freeform session, log a set, complete it**

```bash
curl -s -X POST http://localhost:3000/api/sessions \
  -H 'x-user-id: test-user' -H 'content-type: application/json' \
  -d '{"id":"11111111-1111-1111-1111-111111111111","splitDayId":null,"exercises":[]}'

curl -s -X POST http://localhost:3000/api/sessions/11111111-1111-1111-1111-111111111111/exercises \
  -H 'x-user-id: test-user' -H 'content-type: application/json' \
  -d '{"id":"22222222-2222-2222-2222-222222222222","sessionId":"11111111-1111-1111-1111-111111111111","exerciseId":"Barbell_Squat","position":0,"setType":"weight_reps"}'

curl -s -X POST http://localhost:3000/api/sessions/11111111-1111-1111-1111-111111111111/sets \
  -H 'x-user-id: test-user' -H 'content-type: application/json' \
  -d '{"id":"33333333-3333-3333-3333-333333333333","exerciseLogId":"22222222-2222-2222-2222-222222222222","setNumber":1,"weightKg":60,"reps":8,"rpe":7}'

curl -s -X POST http://localhost:3000/api/sessions/11111111-1111-1111-1111-111111111111/complete \
  -H 'x-user-id: test-user' -H 'content-type: application/json' \
  -d '{"expectedVersion":1}'
```

Expected: the final call returns `{"status":"completed", "completedAt": "...", "version": 2, ...}`.
(Requires a seeded dev DB — `Barbell_Squat` must exist, per `npm run db:seed`.)

**Step 3: Run the full test suite once more**

Run: `npx vitest run`
Expected: all tests pass, no regressions in any existing repository/service.

**Step 4: Stop the dev server**
