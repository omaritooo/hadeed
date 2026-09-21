# Past Workout Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a lifter log a workout they missed, dated up to 14 days back, from a single quick form, with the same XP, PRs and achievements as a live session.

**Architecture:** A new `POST /api/sessions/past` takes the whole workout in one request. `SessionService.logPastSession` validates it, writes the session, exercise logs and sets in one `db.batch` transaction with synthetic ordered timestamps, then runs rewards: set XP, PR detection, re-detection of PRs on later sets, session XP and achievements. A `GET /api/workouts/past-options` endpoint feeds the form with the split days and their exercises. Sessions logged this way carry `logged_retroactively = 1`, so they show "Logged later" instead of a fake duration.

**Tech Stack:** Nuxt 4 (Vue 3, `<script setup>`), Nitro/h3 routes, libSQL/Turso (`@libsql/client`), Pinia Colada queries, Vitest with a file-backed test DB (`createTestDb`).

**Design doc:** `docs/plans/2026-09-21-past-workout-logging-design.md`

**Conventions to follow:**
- Standalone functions are arrow functions (`const foo = () => {}`), including test helpers.
- Match the surrounding comment density. Comments explain *why*, not what.
- Work directly on `main`. `docs/` is gitignored but tracked, so commit docs with `git add -f`.
- Run one test file: `npx vitest run <path>`. Run everything: `npm test`.

---

### Task 1: `logged_retroactively` column and "Logged later" in recent sessions

**Files:**
- Modify: `server/database/schema.sql` (after the `ALTER TABLE workout_sessions ADD COLUMN rounds ...` line, ~line 326)
- Modify: `shared/types/home.types.ts` (`RecentSessionSummary`, ~line 38)
- Modify: `shared/types/session.types.ts` (`WorkoutSession`)
- Modify: `server/repositories/session.repository.ts` (`mapSession` ~line 84, `findRecentCompletedSummaries` ~line 734)
- Test: `tests/server/repositories/session.repository.test.ts`

**Step 1: Write the failing test**

Append to `tests/server/repositories/session.repository.test.ts`, inside the top-level `describe`. Reuse that file's existing `db`/`repo` setup and user seed. If the file names them differently, adapt the names but not the assertions.

```ts
it('reports a retroactively logged session with no duration', async () => {
  await repo.startSession('user-1', { id: 'past-1', splitDayId: null, exercises: [] })
  await db.execute(`UPDATE workout_sessions
                    SET status = 'completed', started_at = '2026-09-10 08:00:00',
                        completed_at = '2026-09-10 08:00:05', logged_retroactively = 1
                    WHERE id = 'past-1'`)

  const [summary] = await repo.findRecentCompletedSummaries('user-1', 5)

  expect(summary!.loggedRetroactively).toBe(true)
  expect(summary!.durationMinutes).toBeNull()
  expect((await repo.findSessionById('past-1'))!.loggedRetroactively).toBe(true)
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts -t "retroactively"`
Expected: FAIL with `no such column: logged_retroactively`.

**Step 3: Implement**

In `schema.sql`, below the `rounds` ALTER:

```sql
-- Set by POST /api/sessions/past: the session was entered after the fact, so its set timestamps
-- are synthetic (one second apart) and its duration means nothing. Readers show "Logged later"
-- instead of a duration.
ALTER TABLE workout_sessions ADD COLUMN logged_retroactively INTEGER NOT NULL DEFAULT 0;
```

In `shared/types/session.types.ts`, add to `WorkoutSession` after `rounds`:

```ts
  loggedRetroactively: boolean
```

In `shared/types/home.types.ts`, add to `RecentSessionSummary` after `durationMinutes`:

```ts
  loggedRetroactively: boolean
```

In `session.repository.ts`:
- In `mapSession`, add `loggedRetroactively: Boolean(row.logged_retroactively),`.
- In `findRecentCompletedSummaries`, replace the duration expression:

```ts
                   CASE WHEN logged_retroactively = 1 THEN NULL
                        ELSE ROUND((julianday(completed_at) - julianday(started_at)) * 24 * 60) END AS duration_minutes
```

- In the same method's returned object, add `loggedRetroactively: Boolean(sessionRow.logged_retroactively),`.

**Step 4: Run the tests**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts tests/server/services`
Expected: PASS. If an existing test uses `toEqual` on a full `WorkoutSession` or `RecentSessionSummary`, add `loggedRetroactively: false` to its expected object.

**Step 5: Commit**

```bash
git add server/database/schema.sql shared/types/home.types.ts shared/types/session.types.ts server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat(sessions): flag retroactively logged sessions and hide their duration"
```

---

### Task 2: Shared validation and timestamp helper

**Files:**
- Create: `shared/lib/past-session.ts`
- Modify: `shared/types/session.types.ts` (append the input/result types)
- Test: `tests/shared/lib/past-session.test.ts`

**Step 1: Add the types**

Append to `shared/types/session.types.ts`:

```ts
export interface PastSessionExerciseInput {
  id: string // exercise_log id, client-generated
  exerciseId: string
  splitExerciseId: number | null
  setType: SetType
  targetSets: number | null
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetRpe: number | null
  sets: number
  reps: number | null
  weightKg: number | null
}

export interface PastSessionInput {
  id: string // workout_sessions id, client-generated so a retried save is idempotent
  startedAt: string // ISO datetime
  splitDayId: number | null
  exercises: PastSessionExerciseInput[]
}

export interface PastSessionResult {
  sessionId: string
  prsHit: SessionPrHit[]
}
```

(`SessionPrHit` is already declared in this file.)

**Step 2: Write the failing test**

Create `tests/shared/lib/past-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pastSessionTimestamps, validatePastSession } from '~~/shared/lib/past-session'
import type { PastSessionInput } from '~~/shared/types/session.types'

const NOW = new Date('2026-09-21T10:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

const input = (overrides: Partial<PastSessionInput> = {}): PastSessionInput => ({
  id: 's1',
  startedAt: daysAgo(2),
  splitDayId: null,
  exercises: [{
    id: 'e1', exerciseId: 'bench-press', splitExerciseId: null, setType: 'weight_reps',
    targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRpe: null,
    sets: 3, reps: 10, weightKg: 60,
  }],
  ...overrides,
})

describe('validatePastSession', () => {
  it('accepts today and 14 days back', () => {
    expect(validatePastSession(input({ startedAt: NOW.toISOString() }), NOW)).toBeNull()
    expect(validatePastSession(input({ startedAt: daysAgo(14) }), NOW)).toBeNull()
  })

  it('rejects the future', () => {
    expect(validatePastSession(input({ startedAt: new Date(NOW.getTime() + 3_600_000).toISOString() }), NOW)).toMatch(/future/)
  })

  it('rejects anything past the window plus a day of timezone slack', () => {
    expect(validatePastSession(input({ startedAt: daysAgo(16) }), NOW)).toMatch(/14 days/)
  })

  it('rejects an unparseable date', () => {
    expect(validatePastSession(input({ startedAt: 'yesterday' }), NOW)).toMatch(/startedAt/)
  })

  it('rejects an empty workout and an exercise with no sets', () => {
    expect(validatePastSession(input({ exercises: [] }), NOW)).toMatch(/exercise/)
    expect(validatePastSession(input({ exercises: [{ ...input().exercises[0]!, sets: 0 }] }), NOW)).toMatch(/set/)
  })

  it('rejects a weighted exercise with no weight or reps', () => {
    expect(validatePastSession(input({ exercises: [{ ...input().exercises[0]!, weightKg: null }] }), NOW)).toMatch(/weight/)
    expect(validatePastSession(input({ exercises: [{ ...input().exercises[0]!, reps: null }] }), NOW)).toMatch(/reps/)
  })
})

describe('pastSessionTimestamps', () => {
  it('spaces sets one second apart after the start and completes one second after the last', () => {
    const start = new Date('2026-09-16T07:45:00Z')
    const { startedAt, setTimes, completedAt } = pastSessionTimestamps(start, 3, NOW)
    expect(startedAt.toISOString()).toBe('2026-09-16T07:45:00.000Z')
    expect(setTimes.map(t => t.toISOString())).toEqual([
      '2026-09-16T07:45:01.000Z', '2026-09-16T07:45:02.000Z', '2026-09-16T07:45:03.000Z',
    ])
    expect(completedAt.toISOString()).toBe('2026-09-16T07:45:04.000Z')
  })

  it('pulls a start of "now" back so no set lands in the future', () => {
    const { completedAt } = pastSessionTimestamps(NOW, 5, NOW)
    expect(completedAt.getTime()).toBeLessThanOrEqual(NOW.getTime())
  })
})
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/shared/lib/past-session.test.ts`
Expected: FAIL, module `~~/shared/lib/past-session` not found.

**Step 4: Implement**

Create `shared/lib/past-session.ts`:

```ts
import type { PastSessionInput } from '~~/shared/types/session.types'

export const PAST_SESSION_MAX_DAYS = 14

const DAY_MS = 86_400_000
// The form limits dates by the lifter's local calendar, and the server only sees UTC, so the
// server floor allows one extra day rather than rejecting a valid "14 days ago" east of UTC.
const SERVER_FLOOR_MS = (PAST_SESSION_MAX_DAYS + 1) * DAY_MS
// A client clock a little ahead of the server's shouldn't make "today" read as the future.
const FUTURE_SLACK_MS = 5 * 60_000

// Returns a user-facing reason, or null when the input is valid.
export const validatePastSession = (input: PastSessionInput, now: Date): string | null => {
  const startedAt = new Date(input.startedAt)
  if (Number.isNaN(startedAt.getTime())) return 'startedAt must be a valid date'
  if (startedAt.getTime() > now.getTime() + FUTURE_SLACK_MS) return 'A past workout cannot be in the future'
  if (startedAt.getTime() < now.getTime() - SERVER_FLOOR_MS) return `A past workout can be at most ${PAST_SESSION_MAX_DAYS} days old`
  if (input.exercises.length === 0) return 'Add at least one exercise'

  for (const exercise of input.exercises) {
    if (!Number.isInteger(exercise.sets) || exercise.sets < 1) return 'Every exercise needs at least one set'
    if (exercise.setType === 'time') continue
    if (exercise.reps === null || exercise.reps < 1) return 'Every exercise needs reps'
    if (exercise.setType === 'weight_reps' && (exercise.weightKg === null || exercise.weightKg < 0)) return 'Every weighted exercise needs a weight'
  }
  return null
}

// Synthetic, strictly increasing timestamps: PR detection and history order sets by
// (logged_at, rowid), so a backfilled workout must keep its sets in form order and sit entirely
// before anything logged later. The start is pulled back when needed so no set lands after `now`.
export const pastSessionTimestamps = (requestedStart: Date, setCount: number, now: Date) => {
  const latestStart = now.getTime() - (setCount + 1) * 1000
  const start = new Date(Math.min(requestedStart.getTime(), latestStart))
  start.setUTCMilliseconds(0)
  const at = (offsetSeconds: number) => new Date(start.getTime() + offsetSeconds * 1000)
  return {
    startedAt: start,
    setTimes: Array.from({ length: setCount }, (_, i) => at(i + 1)),
    completedAt: at(setCount + 1),
  }
}
```

**Step 5: Run the test**

Run: `npx vitest run tests/shared/lib/past-session.test.ts`
Expected: PASS (8 tests).

**Step 6: Commit**

```bash
git add shared/lib/past-session.ts shared/types/session.types.ts tests/shared/lib/past-session.test.ts
git commit -m "feat(sessions): validate past-workout input and derive ordered set timestamps"
```

---

### Task 3: Repository writes and lookups

**Files:**
- Modify: `server/repositories/session.repository.ts` (new interface near the other inputs at the top, and new methods after `findWorkingSetsBefore`, ~line 456)
- Modify: `server/repositories/block.repository.ts` (new method `findSplitDayOwnerId`)
- Test: `tests/server/repositories/session.repository.test.ts`, `tests/server/repositories/block.repository.test.ts`

**Step 1: Write the failing tests**

Append to `session.repository.test.ts`. Seed a `bench-press` exercise the same way the file already seeds exercises.

```ts
const pastInput = (id: string, startedAt: string, weightKg: number) => ({
  id,
  splitDayId: null,
  startedAt,
  completedAt: startedAt.replace(/:00$/, ':09'),
  exercises: [{
    id: `${id}-e1`, exerciseId: 'bench-press', splitExerciseId: null, position: 0, setType: 'weight_reps' as const,
    targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRpe: null,
    sets: [1, 2].map(n => ({ id: `${id}-set-${n}`, setNumber: n, weightKg, reps: 10, loggedAt: startedAt.replace(/:00$/, `:0${n}`) })),
  }],
})

it('inserts a past session as completed and retroactive, with its sets', async () => {
  await repo.insertPastSession('user-1', pastInput('past-1', '2026-09-10 08:00:00', 60))

  const session = await repo.findWithLogs('past-1')
  expect(session!.status).toBe('completed')
  expect(session!.loggedRetroactively).toBe(true)
  expect(session!.startedAt).toBe('2026-09-10 08:00:00')
  expect(session!.exercises[0]!.sets.map(s => s.loggedAt)).toEqual(['2026-09-10 08:00:01', '2026-09-10 08:00:02'])
})

it('finds working sets of an exercise logged after a given set, oldest first', async () => {
  await repo.insertPastSession('user-1', pastInput('past-1', '2026-09-10 08:00:00', 60))
  await repo.insertPastSession('user-1', pastInput('past-2', '2026-09-12 08:00:00', 65))

  const later = await repo.findWorkingSetsAfter('user-1', 'bench-press', 'past-1-set-2')

  expect(later.map(s => s.id)).toEqual(['past-2-set-1', 'past-2-set-2'])
})
```

Append to `block.repository.test.ts`, using that file's existing block-creation helper:

```ts
it('finds the owner of a split day, or null for an unknown one', async () => {
  // create a block for user-1 with one day, the way the other tests in this file do
  const dayId = /* id of the created day */
  expect(await repo.findSplitDayOwnerId(dayId)).toBe('user-1')
  expect(await repo.findSplitDayOwnerId(999_999)).toBeNull()
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts tests/server/repositories/block.repository.test.ts`
Expected: FAIL, `insertPastSession` / `findWorkingSetsAfter` / `findSplitDayOwnerId` is not a function.

**Step 3: Implement**

In `session.repository.ts`, add near the other input interfaces:

```ts
export interface InsertPastSessionInput {
  id: string
  splitDayId: number | null
  startedAt: string // SQLite datetime
  completedAt: string
  exercises: Array<Omit<StartSessionExerciseInput, 'restSeconds' | 'suggestion'> & {
    sets: Array<{ id: string, setNumber: number, weightKg: number | null, reps: number | null, loggedAt: string }>
  }>
}
```

Add after `findWorkingSetsBefore`:

```ts
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
          args: [exercise.id, input.id, exercise.exerciseId, exercise.splitExerciseId, exercise.position, exercise.setType,
            exercise.targetSets, ...repRangeArgs(exercise), exercise.targetRpe],
        },
        ...exercise.sets.map(set => ({
          sql: `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, logged_at) VALUES (?, ?, ?, ?, ?, ?)`,
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
```

Check that `repRangeArgs(exercise)` returns `[targetReps, targetRepsMin, targetRepsMax]`, the three values `attachExercise` spreads into the same columns. If it returns a different shape, match how `attachExercise` uses it.

In `block.repository.ts`, add:

```ts
  async findSplitDayOwnerId(splitDayId: number): Promise<string | null> {
    const result = await this.db.execute({
      sql: 'SELECT b.user_id FROM split_days sd JOIN blocks b ON b.id = sd.block_id WHERE sd.id = ?',
      args: [splitDayId],
    })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    return row ? (row.user_id as string) : null
  }
```

**Step 4: Run tests**

Run: `npx vitest run tests/server/repositories`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts server/repositories/block.repository.ts tests/server/repositories/session.repository.test.ts tests/server/repositories/block.repository.test.ts
git commit -m "feat(sessions): insert a past session in one batch and look up later working sets"
```

---

### Task 4: Session XP for a past session, without streak side effects

**Files:**
- Modify: `server/services/gamification.service.ts` (after `onSessionCompleted`, ~line 60)
- Test: `tests/server/services/gamification.service.test.ts`

**Step 1: Write the failing test**

Append, using the file's existing setup (real `XpRepository` and `StreakRepository` on a test DB, with user `user-1`). If the setup differs, adapt the names:

```ts
it('awards session XP for a past session without touching the streak', async () => {
  const before = await streaks.findForUser('user-1')

  await service.onPastSessionLogged('user-1', 'past-1')

  expect(await xp.countBySourceType('user-1', 'session_completed')).toBe(1)
  expect(await streaks.findForUser('user-1')).toEqual(before)
})
```

**Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/services/gamification.service.test.ts -t "past session"`
Expected: FAIL, `onPastSessionLogged` is not a function.

**Step 3: Implement**

```ts
  // A backdated session earns the completion bonus and can unlock achievements, but skips
  // recordActiveDay: that stamps today's date, which is exactly wrong for a past workout. The
  // derived week streak reads sessions' started_at, so it counts the day on its own.
  async onPastSessionLogged(userId: string, sessionId: string): Promise<void> {
    await this.xp.award(userId, XP_SESSION_COMPLETE_BONUS, 'session_completed', sessionId)
    await this.evaluateAchievements(userId)
  }
```

**Step 4: Run tests**

Run: `npx vitest run tests/server/services/gamification.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/services/gamification.service.ts tests/server/services/gamification.service.test.ts
git commit -m "feat(gamification): award past sessions without stamping today's streak"
```

---

### Task 5: `SessionService.logPastSession`

**Files:**
- Modify: `server/services/session.service.ts`
- Test: `tests/server/services/session.service.test.ts`

**Step 1: Write the failing tests**

Append a new `describe` to `session.service.test.ts`:

```ts
describe('SessionService.logPastSession', () => {
  let db: Client
  let sessions: SessionRepository
  let xp: XpRepository
  let prs: PersonalRecordRepository
  let service: SessionService

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    xp = new XpRepository(db)
    prs = new PersonalRecordRepository(db)
    const streaks = new StreakRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`)
    const gamification = new GamificationService(xp, streaks, new AchievementRepository(db), sessions)
    service = new SessionService(ctx(), sessions, new BlockRepository(db), gamification, prs, streaks)
  })

  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
  const past = (id: string, weightKg: number, overrides: Partial<PastSessionInput> = {}): PastSessionInput => ({
    id,
    startedAt: daysAgo(3),
    splitDayId: null,
    exercises: [{
      id: `${id}-e1`, exerciseId: 'bench-press', splitExerciseId: null, setType: 'weight_reps',
      targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRpe: null,
      sets: 3, reps: 8, weightKg,
    }],
    ...overrides,
  })

  // A live session today: 60x8, then a 65x8 weight PR.
  const logLiveSession = async () => {
    await sessions.startSession('user-1', { id: 'live', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'live-e1', sessionId: 'live', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await service.logSet({ id: 'live-1', exerciseLogId: 'live-e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null })
    await service.logSet({ id: 'live-2', exerciseLogId: 'live-e1', setNumber: 2, weightKg: 65, reps: 8, rpe: null })
  }

  it('writes a completed, retroactive session dated to the chosen day', async () => {
    await service.logPastSession(past('p1', 60))

    const session = await sessions.findWithLogs('p1')
    expect(session!.status).toBe('completed')
    expect(session!.loggedRetroactively).toBe(true)
    expect(session!.startedAt.slice(0, 10)).toBe(daysAgo(3).slice(0, 10))
    expect(session!.exercises[0]!.sets).toHaveLength(3)
  })

  it('awards set and session XP', async () => {
    await service.logPastSession(past('p1', 60))
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(3)
    expect(await xp.countBySourceType('user-1', 'session_completed')).toBe(1)
  })

  it('rejects an out-of-window date with 422', async () => {
    await expect(service.logPastSession(past('p1', 60, { startedAt: daysAgo(20) }))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects someone else\'s split day', async () => {
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    await new BlockRepository(db).createWithDays('user-2', {
      programId: null, name: 'Theirs', startDate: '2020-01-01', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [{ name: 'Day', dayOfWeek: 0, location: 'gym', exercises: [] }],
    })
    const day = await db.execute('SELECT id FROM split_days LIMIT 1')

    await expect(service.logPastSession(past('p1', 60, { splitDayId: day.rows[0]!.id as number }))).rejects.toThrow(/forbidden/i)
  })

  it('is idempotent on replay: no duplicate rows or XP', async () => {
    await service.logPastSession(past('p1', 60))
    await service.logPastSession(past('p1', 60))
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(3)
    expect(await xp.countBySourceType('user-1', 'session_completed')).toBe(1)
  })

  it('turns a later PR into a non-PR when a heavier set is backdated before it', async () => {
    await logLiveSession()
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(1)

    await service.logPastSession(past('p1', 70))

    expect(await prs.findForSession('user-1', 'live')).toEqual([])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
  })

  it('keeps later PRs that still beat a lighter backdated set', async () => {
    await logLiveSession()

    await service.logPastSession(past('p1', 50))

    const livePrSets = (await prs.findForSession('user-1', 'live')).map(hit => hit.weightKg)
    expect(livePrSets).toContain(65)
  })
})
```

Add `import type { PastSessionInput } from '~~/shared/types/session.types'` to the file's imports.

**Step 2: Run to verify they fail**

Run: `npx vitest run tests/server/services/session.service.test.ts -t "logPastSession"`
Expected: FAIL, `logPastSession` is not a function.

**Step 3: Implement**

In `session.service.ts`, add imports:

```ts
import { randomUUID } from 'node:crypto'
import type { PastSessionInput, PastSessionResult } from '~~/shared/types/session.types'
import { pastSessionTimestamps, validatePastSession } from '~~/shared/lib/past-session'
import type { InsertPastSessionInput } from '~~/server/repositories/session.repository'
```

Add these methods to the class, after `completeSession`:

```ts
  async logPastSession(input: PastSessionInput, now = new Date()): Promise<PastSessionResult> {
    const invalid = validatePastSession(input, now)
    if (invalid) throw createError({ statusCode: 422, statusMessage: invalid })

    // A retried save returns what the first one wrote, and never re-runs rewards.
    const existing = await this.sessions.findSessionById(input.id)
    if (existing) {
      this.requireOwner(existing.userId)
      return { sessionId: existing.id, prsHit: await this.personalRecords.findForSession(this.ctx.userId, existing.id) }
    }

    if (input.splitDayId !== null) {
      const ownerId = await this.blocks.findSplitDayOwnerId(input.splitDayId)
      if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Split day not found' })
      this.requireOwner(ownerId)
    }

    const totalSets = input.exercises.reduce((sum, exercise) => sum + exercise.sets, 0)
    const times = pastSessionTimestamps(new Date(input.startedAt), totalSets, now)
    let setIndex = 0
    const exercises: InsertPastSessionInput['exercises'] = input.exercises.map((exercise, position) => ({
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      splitExerciseId: exercise.splitExerciseId,
      position,
      setType: exercise.setType,
      targetSets: exercise.targetSets,
      targetRepsMin: exercise.targetRepsMin,
      targetRepsMax: exercise.targetRepsMax,
      targetRpe: exercise.targetRpe,
      sets: Array.from({ length: exercise.sets }, (_, i) => ({
        id: randomUUID(),
        setNumber: i + 1,
        weightKg: exercise.setType === 'weight_reps' ? exercise.weightKg : null,
        reps: exercise.setType === 'time' ? null : exercise.reps,
        loggedAt: toSqliteDatetime(times.setTimes[setIndex++]!),
      })),
    }))

    await this.sessions.insertPastSession(this.ctx.userId, {
      id: input.id,
      splitDayId: input.splitDayId,
      startedAt: toSqliteDatetime(times.startedAt),
      completedAt: toSqliteDatetime(times.completedAt),
      exercises,
    })

    // Same rule as logSet: the workout is durably stored, so a reward failure is logged, not surfaced.
    try {
      await this.rewardPastSession(input.id, exercises)
    } catch (error) {
      console.error('SessionService.logPastSession: rewards failed after past session stored', { sessionId: input.id, error })
    }

    return { sessionId: input.id, prsHit: await this.personalRecords.findForSession(this.ctx.userId, input.id) }
  }

  private async rewardPastSession(sessionId: string, exercises: InsertPastSessionInput['exercises']): Promise<void> {
    const userId = this.ctx.userId
    for (const exercise of exercises) {
      for (const set of exercise.sets) {
        await this.gamification.onSetLogged(userId, set.id)
        await this.recordPersonalRecords({ ...set, exerciseLogId: exercise.id, rpe: null, isWarmup: false, version: 1 })
      }
    }

    // The backdated sets joined the baseline of everything logged after them, so those sets' PRs
    // are torn down and re-detected, the same way editSet handles a corrected set.
    for (const exercise of exercises) {
      const lastSet = exercise.sets.at(-1)
      if (!lastSet) continue
      for (const later of await this.sessions.findWorkingSetsAfter(userId, exercise.exerciseId, lastSet.id)) {
        await this.personalRecords.deleteForSet(later.id)
        await this.gamification.revokeSetRewards(userId, later.id, { includeSetXp: false })
        await this.recordPersonalRecords(later)
      }
    }

    await this.gamification.onPastSessionLogged(userId, sessionId)
  }
```

`toSqliteDatetime` is already imported from `~~/server/utils/date` in this file.

**Step 4: Run tests**

Run: `npx vitest run tests/server/services/session.service.test.ts`
Expected: PASS (all tests, old and new).

**Step 5: Commit**

```bash
git add server/services/session.service.ts tests/server/services/session.service.test.ts
git commit -m "feat(sessions): log a past session with full rewards and PR re-detection"
```

---

### Task 6: `POST /api/sessions/past` route

**Files:**
- Create: `server/api/sessions/past.post.ts`

**Step 1: Implement** (thin route; the service tests cover the behaviour)

```ts
import { readBody } from 'h3'
import { useSessionService } from '~~/server/utils/session-service'
import type { PastSessionInput } from '~~/shared/types/session.types'

defineRouteMeta({
  openAPI: {
    summary: 'Log a past workout',
    description: 'Writes a completed session dated up to 14 days back in one transaction, then awards set/session XP and re-detects PRs on later sets. Idempotent on id.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'startedAt', 'exercises'],
            properties: {
              id: { type: 'string' },
              startedAt: { type: 'string', format: 'date-time' },
              splitDayId: { type: 'number', nullable: true },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'exerciseId', 'setType', 'sets'],
                  properties: {
                    id: { type: 'string' },
                    exerciseId: { type: 'string' },
                    splitExerciseId: { type: 'number', nullable: true },
                    setType: { type: 'string', enum: ['weight_reps', 'bodyweight_reps', 'time'] },
                    targetSets: { type: 'number', nullable: true },
                    targetRepsMin: { type: 'number', nullable: true },
                    targetRepsMax: { type: 'number', nullable: true },
                    targetRpe: { type: 'number', nullable: true },
                    sets: { type: 'number' },
                    reps: { type: 'number', nullable: true },
                    weightKg: { type: 'number', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The stored session id and any PRs it set' },
      403: { description: 'Split day or session id belongs to someone else' },
      422: { description: 'Date outside the 14-day window, or an incomplete exercise' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as PastSessionInput
  const service = await useSessionService(event)
  return service.logPastSession({ ...body, splitDayId: body.splitDayId ?? null })
})
```

**Step 2: Commit**

```bash
git add server/api/sessions/past.post.ts
git commit -m "feat(sessions): add POST /api/sessions/past"
```

---

### Task 7: Form options endpoint

**Files:**
- Modify: `shared/types/workouts.types.ts`
- Modify: `server/services/workouts.service.ts`
- Create: `server/api/workouts/past-options.get.ts`
- Test: `tests/server/services/workouts.service.test.ts`

**Step 1: Add the type**

Append to `shared/types/workouts.types.ts`:

```ts
export interface PastWorkoutOptions {
  // Non-rest days of the block active today, in weekday order, shaped like today's workout.
  days: TodaysWorkout[]
}
```

(`TodaysWorkout` is already imported at the top of this file.)

**Step 2: Write the failing test**

Append to `workouts.service.test.ts`:

```ts
it('lists every non-rest day of the active block as past-workout options, in weekday order', async () => {
  await blocks.createWithDays('user-1', {
    programId: null, name: 'Block', startDate: '2020-01-01', endDate: null,
    trainingDayMacroTarget: null, restDayMacroTarget: null,
    days: [
      { name: 'Legs', dayOfWeek: 2, location: 'gym', exercises: [
        { exerciseId: 'squat', position: 0, setType: 'weight_reps', targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRpe: null },
      ] },
      { name: 'Rest', dayOfWeek: 1, location: 'gym', isRestDay: true, exercises: [] },
      { name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [] },
    ],
  })

  const { days } = await service.getPastWorkoutOptions()

  expect(days.map(d => d.dayName)).toEqual(['Push', 'Legs'])
  expect(days[1]!.exercises[0]).toMatchObject({ exerciseId: 'squat', exerciseName: 'Squat', targetSets: 3 })
})
```

If `createWithDays` names the rest-day flag differently, check `CreateBlockInput` in `block.repository.ts` and adapt.

**Step 3: Run to verify it fails**

Run: `npx vitest run tests/server/services/workouts.service.test.ts -t "past-workout"`
Expected: FAIL, `getPastWorkoutOptions` is not a function.

**Step 4: Implement**

In `workouts.service.ts`, move the exercise-mapping half of `buildTodaysWorkout` (everything after `if (!day) return null`) into a private helper, and reuse it:

```ts
  async getPastWorkoutOptions(): Promise<PastWorkoutOptions> {
    const todayIso = new Date().toISOString().slice(0, 10)
    const activeBlock = await this.blocks.findActiveForUser(this.ctx.userId, todayIso)
    const trainingDays: TrainingDay[] = (activeBlock?.days.filter(day => !day.isRestDay) ?? [])
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    return { days: await Promise.all(trainingDays.map(day => this.describeDay(this.ctx.userId, day))) }
  }

  private async describeDay(userId: string, day: TrainingDay): Promise<TodaysWorkout> {
    // ...the existing body from `const exerciseIds = ...` through the returned object, unchanged
  }
```

`buildTodaysWorkout` then ends with `return this.describeDay(userId, day)`. Add `PastWorkoutOptions` to the type import from `~~/shared/types/workouts.types`.

Create `server/api/workouts/past-options.get.ts` by copying `server/api/workouts/index.get.ts`, then change the summary to `'List split days for logging a past workout'`, the description to `'Every non-rest day of the active block with its exercises and last-performed loads, for the past-workout form.'`, and the last line to `return service.getPastWorkoutOptions()`.

**Step 5: Run tests**

Run: `npx vitest run tests/server/services/workouts.service.test.ts`
Expected: PASS, including the existing `todaysWorkout` tests (the refactor must not change them).

**Step 6: Commit**

```bash
git add shared/types/workouts.types.ts server/services/workouts.service.ts server/api/workouts/past-options.get.ts tests/server/services/workouts.service.test.ts
git commit -m "feat(workouts): serve split days as past-workout form options"
```

---

### Task 8: Composables

**Files:**
- Modify: `app/composables/query-keys.ts`
- Create: `app/composables/usePastWorkoutOptions.ts`
- Create: `app/composables/useLogPastSession.ts`

**Step 1: Implement**

In `query-keys.ts`, add `pastWorkoutOptions: () => ['past-workout-options'] as const,` after `workouts`.

`usePastWorkoutOptions.ts`:

```ts
import type { FetchError } from 'ofetch'
import type { PastWorkoutOptions } from '~~/shared/types/workouts.types'
import { useQuery } from '@pinia/colada'

export const usePastWorkoutOptions = () => {
  const { $api } = useNuxtApp()

  return useQuery<PastWorkoutOptions, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.pastWorkoutOptions(),
    query: () => $api<PastWorkoutOptions>('/api/workouts/past-options'),
  })
}
```

`useLogPastSession.ts`:

```ts
import type { FetchError } from 'ofetch'
import type { PastSessionInput, PastSessionResult } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useLogPastSession = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<PastSessionResult, PastSessionInput, FetchError<{ statusMessage: string }>>({
    // The caller generates input.id once per form, so a retried save is the same session.
    mutation: input => $api<PastSessionResult>('/api/sessions/past', { method: 'POST', body: input }),
    // A backdated session changes history, weekly volume, PRs, XP and the last-performed loads.
    onSuccess: () => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.workouts() }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
      queryCache.invalidateQueries({ key: queryKeys.weeklyVolume() }),
      queryCache.invalidateQueries({ key: queryKeys.achievements() }),
      queryCache.invalidateQueries({ key: queryKeys.pastWorkoutOptions() }),
      queryCache.invalidateQueries({ key: ['volume-history'] }),
      queryCache.invalidateQueries({ key: ['pr-history'] }),
      queryCache.invalidateQueries({ key: ['exercise-history'] }),
    ]),
  })
}
```

**Step 2: Commit**

```bash
git add app/composables/query-keys.ts app/composables/usePastWorkoutOptions.ts app/composables/useLogPastSession.ts
git commit -m "feat(workouts): add past-workout options query and log mutation"
```

---

### Task 9: The form page, entry link and "Logged later" label

**Files:**
- Create: `app/pages/workouts/log-past.vue`
- Modify: `app/pages/workouts/index.vue` (entry link, and the Recent Sessions card ~line 206)
- Modify: `app/pages/index.vue:187` (home's last-session duration label)

**Step 1: Create the page**

`app/pages/workouts/log-past.vue`:

```vue
<script setup lang="ts">
import { ArrowLeftIcon, TrashIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { kgToLbs, lbsToKg } from "~~/shared/lib/formulas";
import { PAST_SESSION_MAX_DAYS } from "~~/shared/lib/past-session";
import type { SetType } from "~~/shared/types/split.types";
import type { TodaysWorkoutExercise } from "~~/shared/types/home.types";

// Form drafts are strings (same convention as NumberStepper) and become numbers at submit.
interface Row {
  key: string;
  exerciseId: string;
  exerciseName: string;
  splitExerciseId: number | null;
  setType: SetType;
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetRpe: number | null;
  sets: string;
  reps: string;
  weight: string;
}

const { data: options, isLoading } = usePastWorkoutOptions();
const { data: profileData } = useProfile();
const logPast = useLogPastSession();

const unitSystem = computed(() => profileData.value?.profile?.unitSystem ?? "metric");
const unitLabel = computed(() => (unitSystem.value === "imperial" ? "lbs" : "kg"));
const toDisplay = (kg: number) => (unitSystem.value === "imperial" ? Math.round(kgToLbs(kg)) : kg);
const toKg = (value: number) => (unitSystem.value === "imperial" ? lbsToKg(value) : value);

const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const dateChoices = Array.from({ length: PAST_SESSION_MAX_DAYS + 1 }, (_, daysBack) => {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  const label = daysBack === 0 ? "Today" : daysBack === 1 ? "Yesterday"
    : new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
  return { value: localDate(date), label };
});

// Missed logs are usually from a previous day, so the form opens on yesterday.
const selectedDate = ref(dateChoices[1]!.value);
const selectedDay = ref("freeform");
const rows = ref<Row[]>([]);
// One id per form: a double-tap or retry of Save replays the same session instead of duplicating it.
const sessionId = crypto.randomUUID();
const saveError = ref<string | null>(null);

const rowFromSplit = (exercise: TodaysWorkoutExercise): Row => ({
  key: crypto.randomUUID(),
  exerciseId: exercise.exerciseId,
  exerciseName: exercise.exerciseName,
  splitExerciseId: exercise.splitExerciseId,
  setType: exercise.setType,
  targetSets: exercise.targetSets,
  targetRepsMin: exercise.targetRepsMin,
  targetRepsMax: exercise.targetRepsMax,
  targetRpe: exercise.targetRpe,
  sets: String(exercise.targetSets ?? 3),
  reps: String(exercise.lastPerformed?.reps ?? exercise.targetRepsMin ?? 10),
  weight: exercise.lastPerformed ? String(toDisplay(exercise.lastPerformed.weightKg)) : "",
});

watch(selectedDay, (value) => {
  const day = options.value?.days.find(d => String(d.splitDayId) === value);
  rows.value = day ? day.exercises.map(rowFromSplit) : [];
});

// Add-exercise picker: same combobox + useExerciseSearch pattern as stats.vue.
const picked = ref<string | undefined>(undefined);
const searchTerm = ref("");
const { data: searchResults, isLoading: searching } = useExerciseSearch(searchTerm);
const searchOptions = computed<ComboboxOption[]>(
  () => searchResults.value?.map(exercise => ({ value: exercise.id, label: exercise.name })) ?? [],
);
watch(picked, (id) => {
  if (!id || typeof id !== "string") return;
  const exercise = searchResults.value?.find(e => e.id === id);
  picked.value = undefined;
  searchTerm.value = "";
  if (!exercise) return;
  rows.value = [...rows.value, {
    key: crypto.randomUUID(), exerciseId: exercise.id, exerciseName: exercise.name, splitExerciseId: null,
    setType: "weight_reps", targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRpe: null,
    sets: "3", reps: "10", weight: "",
  }];
});

const removeRow = (key: string) => {
  rows.value = rows.value.filter(row => row.key !== key);
};

const parse = (value: string) => (value.trim() === "" ? null : Number(value));

const save = async () => {
  saveError.value = null;
  const [year, month, day] = selectedDate.value.split("-").map(Number);
  const now = new Date();
  // The chosen day at the current time of day: the form has no time picker, and the exact hour
  // only affects ordering against other sessions that same day.
  const startedAt = new Date(year!, month! - 1, day!, now.getHours(), now.getMinutes()).toISOString();
  try {
    await logPast.mutateAsync({
      id: sessionId,
      startedAt,
      splitDayId: selectedDay.value === "freeform" ? null : Number(selectedDay.value),
      exercises: rows.value.map((row) => {
        const weight = parse(row.weight);
        return {
          id: crypto.randomUUID(),
          exerciseId: row.exerciseId,
          splitExerciseId: row.splitExerciseId,
          setType: row.setType,
          targetSets: row.targetSets,
          targetRepsMin: row.targetRepsMin,
          targetRepsMax: row.targetRepsMax,
          targetRpe: row.targetRpe,
          sets: parse(row.sets) ?? 0,
          reps: parse(row.reps),
          weightKg: weight === null ? null : toKg(weight),
        };
      }),
    });
    await navigateTo("/workouts");
  } catch (error) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage;
    saveError.value = message ?? "Couldn't save the workout. Please try again.";
  }
};
</script>

<template>
  <div v-if="!isLoading" class="flex flex-col gap-y-4 px-4 py-4">
    <NuxtLink to="/workouts" class="flex items-center gap-1 text-sm text-muted-foreground">
      <ArrowLeftIcon class="size-4" /> Workouts
    </NuxtLink>
    <h1 class="font-heading text-3xl font-semibold text-foreground">Log a past workout</h1>

    <UiCard class="grid grid-cols-2 gap-3">
      <label class="space-y-1.5">
        <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Date</span>
        <NativeSelect v-model="selectedDate" class="w-full">
          <NativeSelectOption v-for="choice in dateChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</NativeSelectOption>
        </NativeSelect>
      </label>
      <label class="space-y-1.5">
        <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Workout</span>
        <NativeSelect v-model="selectedDay" class="w-full">
          <NativeSelectOption value="freeform">Freeform</NativeSelectOption>
          <NativeSelectOption v-for="day in options?.days ?? []" :key="day.splitDayId" :value="String(day.splitDayId)">{{ day.dayName }}</NativeSelectOption>
        </NativeSelect>
      </label>
    </UiCard>

    <UiCard v-for="row in rows" :key="row.key" class="space-y-2">
      <div class="flex items-start justify-between gap-2">
        <p class="font-heading text-lg text-foreground">{{ row.exerciseName }}</p>
        <Button variant="ghost" size="icon" :aria-label="`Remove ${row.exerciseName}`" @click="removeRow(row.key)">
          <TrashIcon class="size-4" />
        </Button>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <UiMetricInput v-model="row.sets" label="Sets" unit="×" />
        <UiMetricInput v-if="row.setType !== 'time'" v-model="row.reps" label="Reps" unit="reps" />
        <UiMetricInput v-if="row.setType === 'weight_reps'" v-model="row.weight" label="Weight" :unit="unitLabel" />
      </div>
    </UiCard>

    <Combobox
      v-model="picked"
      v-model:search-term="searchTerm"
      :items="searchOptions"
      :reset-search-term-on-select="false"
      placeholder="Add an exercise…"
      search-placeholder="Search exercises…"
      :empty-text="searching ? 'Searching…' : 'No results found.'"
    />

    <p v-if="saveError" class="text-sm text-destructive">{{ saveError }}</p>
    <Button size="lg" class="w-full" :disabled="rows.length === 0 || logPast.isLoading.value" @click="save">
      Save workout
    </Button>
  </div>
  <UiLoadingIndicator v-else />
</template>
```

Check these against the codebase before moving on:
- `UiMetricInput` is auto-imported from `app/components/ui/MetricInput.vue`. Its `v-model` accepts a `number | string`, so string drafts work.
- `NativeSelectOption` is exported from `@/components/ui/native-select`.
- The mutation's pending flag is `isLoading` in Pinia Colada (some versions call it `asyncStatus === 'loading'`). Match whichever the other pages use.

**Step 2: Add the entry link and the "Logged later" label**

In `app/pages/workouts/index.vue`, directly above the `<UiCard v-if="weeklyVolume?.length"` block:

```vue
    <NuxtLink to="/workouts/log-past" class="text-center text-sm text-muted-foreground underline underline-offset-4">
      Missed a workout? Log it
    </NuxtLink>
```

In the same file's Recent Sessions card, replace the duration badge `<span v-if="session.durationMinutes" ...>` with:

```vue
          <span v-if="session.loggedRetroactively" class="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            Logged later
          </span>
          <span v-else-if="session.durationMinutes" class="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {{ Math.round(session.durationMinutes) }}m
          </span>
```

`app/pages/index.vue:187` already handles a null `durationMinutes` (`durationLabel` becomes null), so it needs no change. Confirm that by reading the template around where `durationLabel` is used.

**Step 3: Commit**

```bash
git add app/pages/workouts/log-past.vue app/pages/workouts/index.vue
git commit -m "feat(workouts): add the log-a-past-workout form"
```

---

### Task 10: Verify end to end, then migrate production

**Step 1: Full test suite, types and lint**

```bash
npm test
npx nuxi typecheck
npx eslint .
```

Expected: all pass. Fix anything these runs turn up before continuing.

**Step 2: Run the app and log a past workout** (use the `run` skill, or `npm run dev`)

Against a local or dev DB:
1. Open `/workouts`, then tap "Missed a workout? Log it".
2. Pick "Yesterday" and a split day. Check that rows pre-fill with the last-performed weights in your unit.
3. Add one exercise via search, remove another, then save.
4. Back on `/workouts`, check that the session appears in Recent Sessions with "Logged later" and yesterday's date.
5. Check that weekly volume includes it (if yesterday is this week), and that XP on the profile rose by 10 per set + 25.
6. Try "Save" twice quickly: only one session should exist.

**Step 3: Production schema change — ask the user first**

Production needs the new column before this code deploys. `npm run db:seed` applies `schema.sql` idempotently (duplicate-column errors are ignored), but it also re-upserts the exercise catalog, foods and roles. **Confirm with the user** whether to run the full seed or only the single statement:

```sql
ALTER TABLE workout_sessions ADD COLUMN logged_retroactively INTEGER NOT NULL DEFAULT 0;
```

**Step 4: Commit any fixes, then report** what was verified and what wasn't.
