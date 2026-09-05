# Workouts Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn `workouts.vue` from a leftover single-exercise component harness into the real daily-training-loop page: see today's plan, start/resume a session, log sets on a dedicated session screen, finish it — reusing the existing session/set backend and the existing exercise-detail drawer content.

**Architecture:** A new `WorkoutsService` (server) absorbs the today's-workout/active-session logic currently private to `HomeService`, exposed via a new `GET /api/workouts`; a new `GET /api/sessions/[id]` exposes the already-existing `findWithLogs` repository method. Six new frontend composables wrap the session lifecycle endpoints (all of which already exist). The existing exercise-detail drawer markup is extracted from `workouts.vue` into a standalone `ExerciseDetailDrawer.vue` so both the rewritten landing page's "today's plan" and the new session-logging route can reuse it unchanged.

**Tech Stack:** Nuxt 4, Vue 3 `<script setup>`, `@pinia/colada` (`useQuery`/`useMutation`), `@libsql/client`, Vitest.

Design reference: `docs/plans/2026-09-05-workouts-page-design.md`.

---

## Task 1: Generalize `findMostRecentCompletedSummary` into `findRecentCompletedSummaries`

**Files:**
- Modify: `server/repositories/session.repository.ts:532-565` (the `findMostRecentCompletedSummary` method)
- Modify: `server/services/home.service.ts:67` (its one caller)
- Test: `tests/server/repositories/session.repository.test.ts`

**Step 1: Write the failing test**

Open `tests/server/repositories/session.repository.test.ts`, find the existing test(s) covering `findMostRecentCompletedSummary` (search the file for that name) and add a new test alongside them:

```ts
it('findRecentCompletedSummaries returns multiple sessions, most recent first', async () => {
  await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('squat', 'Squat', '[]')" })

  for (const [id, weight] of [['s1', 100], ['s2', 110], ['s3', 120]] as const) {
    await sessions.startSession('user-1', { id, splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: `${id}-ex`, sessionId: id, exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: `${id}-set`, exerciseLogId: `${id}-ex`, setNumber: 1, weightKg: weight, reps: 5, rpe: 8 })
    await sessions.completeSession(id, 1)
  }

  const results = await sessions.findRecentCompletedSummaries('user-1', 2)

  expect(results).toHaveLength(2)
  expect(results[0]?.sessionId).toBe('s3')
  expect(results[1]?.sessionId).toBe('s2')
})
```

Check the top of the test file for how `sessions` (a `SessionRepository` instance) and `db` are already set up in `beforeEach` — reuse that, don't create a new one.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts -t "findRecentCompletedSummaries"`
Expected: FAIL — `sessions.findRecentCompletedSummaries is not a function`

**Step 3: Implement**

In `server/repositories/session.repository.ts`, replace the existing `findMostRecentCompletedSummary` method with:

```ts
  async findRecentCompletedSummaries(userId: string, limit: number): Promise<RecentSessionSummary[]> {
    const sessionResult = await this.db.execute({
      sql: `SELECT workout_sessions.*, split_days.name AS day_name,
                   ROUND((julianday(completed_at) - julianday(started_at)) * 24 * 60) AS duration_minutes
            FROM workout_sessions
            LEFT JOIN split_days ON split_days.id = workout_sessions.split_day_id
            WHERE workout_sessions.user_id = ? AND workout_sessions.status = 'completed'
            ORDER BY completed_at DESC LIMIT ?`,
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
```

(Keep `findMostRecentCompletedSummary` — `home.service.ts` still calls it for the single "Last Session" card, and it's now a one-line wrapper instead of duplicated logic.)

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: PASS (all tests in the file, including the pre-existing `findMostRecentCompletedSummary` ones — confirms the wrapper preserves behavior)

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat(sessions): generalize recent-session-summary query to return a list"
```

---

## Task 2: Add split-day metadata to `TodaysWorkoutExercise`

The session-start payload needs `splitExerciseId`, `position`, `setType`, `targetRpe` per exercise (see `StartSessionExerciseInput` in `server/repositories/session.repository.ts:15-24`) — `TodaysWorkoutExercise` currently only carries `exerciseId`/`exerciseName`/`targetSets`/`targetReps`, so the frontend can't build a start-session request from it yet.

**Files:**
- Modify: `shared/types/home.types.ts:1-6` (`TodaysWorkoutExercise`)
- Modify: `server/services/home.service.ts:131-136` (the `.map` inside `buildTodaysWorkout`)

**Step 1: Update the type**

In `shared/types/home.types.ts`:

```ts
export interface TodaysWorkoutExercise {
  exerciseId: string
  exerciseName: string
  splitExerciseId: number
  position: number
  setType: import('./split.types').SetType
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}
```

(Use the inline `import('./split.types').SetType` form since `home.types.ts` doesn't currently import from `split.types.ts` — or add a top-level `import type { SetType } from './split.types'` and reference `SetType` directly; either is fine, pick whichever reads cleaner to you and stay consistent with the rest of the file.)

**Step 2: Update the mapping**

In `server/services/home.service.ts`, inside `buildTodaysWorkout`:

```ts
      exercises: day.exercises.map(exercise => ({
        exerciseId: exercise.exerciseId,
        exerciseName: names[exercise.exerciseId] ?? exercise.exerciseId,
        splitExerciseId: exercise.id,
        position: exercise.position,
        setType: exercise.setType,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        targetRpe: exercise.targetRpe,
      })),
```

**Step 3: Typecheck**

Run: `npx vue-tsc --noEmit -p .`
Expected: no errors (there are no other constructors of `TodaysWorkoutExercise` object literals to update — confirm with `grep -rn "TodaysWorkoutExercise" server shared app`)

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: all tests still pass (no test asserts the old narrower shape; if one does, extend its expected object rather than remove the assertion)

**Step 5: Commit**

```bash
git add shared/types/home.types.ts server/services/home.service.ts
git commit -m "feat(home): carry split-exercise metadata needed to start a session"
```

---

## Task 3: Extract `WorkoutsService`

**Files:**
- Create: `server/services/workouts.service.ts`
- Create: `shared/types/workouts.types.ts`
- Modify: `server/services/home.service.ts`
- Test: `tests/server/services/workouts.service.test.ts`
- Test: `tests/server/services/home.service.test.ts` (does not exist yet — you are creating it)

**Step 1: Write the new shared type**

Create `shared/types/workouts.types.ts`:

```ts
import type { ActiveSessionSummary, RecentPr, RecentSessionSummary, TodaysWorkout } from './home.types'

export interface WorkoutsSummary {
  todaysWorkout: TodaysWorkout | null
  activeSession: ActiveSessionSummary | null
  recentSessions: RecentSessionSummary[]
  recentPrs: RecentPr[]
}
```

**Step 2: Write the failing test for `WorkoutsService`**

Create `tests/server/services/workouts.service.test.ts`. Mirror the setup style of `tests/server/services/session.service.test.ts` (same `ctx()` helper, `createTestDb()`, seeding a user with an active block via `BlockRepository.createWithDays`):

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

function ctx(userId = 'user-1'): RequestContext {
  return { userId, roles: [], permissions: [] }
}

describe('WorkoutsService', () => {
  let db: Client
  let sessions: SessionRepository
  let blocks: BlockRepository
  let service: WorkoutsService

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    blocks = new BlockRepository(db)
    service = new WorkoutsService(ctx(), sessions, blocks, new ExerciseRepository(db), new XpRepository(db))
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('squat', 'Squat', '[]')" })
  })

  it('returns null todaysWorkout when there is no active block', async () => {
    const summary = await service.getSummary()
    expect(summary.todaysWorkout).toBeNull()
    expect(summary.activeSession).toBeNull()
    expect(summary.recentSessions).toEqual([])
  })

  it('returns the next unstarted day as todaysWorkout, with split-exercise metadata', async () => {
    await blocks.createWithDays('user-1', {
      programId: null,
      name: 'Block',
      startDate: '2020-01-01',
      endDate: null,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: [
        { name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [
          { exerciseId: 'squat', position: 0, setType: 'weight_reps', targetSets: 3, targetReps: 5, targetRpe: 8 },
        ] },
      ],
    })

    const summary = await service.getSummary()

    expect(summary.todaysWorkout?.dayName).toBe('Push')
    expect(summary.todaysWorkout?.exercises[0]).toMatchObject({
      exerciseId: 'squat',
      setType: 'weight_reps',
      targetSets: 3,
    })
  })

  it('includes an in-progress session as activeSession', async () => {
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })

    const summary = await service.getSummary()

    expect(summary.activeSession?.sessionId).toBe('session-1')
  })
})
```

Note: check `BlockRepository.createWithDays`'s exact `days[].exercises[]` input shape (`grep -n "CreateBlockInput\|interface.*Day" server/repositories/block.repository.ts`) before running this — adjust the seed shape in the test to match exactly if it differs from the guess above.

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/server/services/workouts.service.test.ts`
Expected: FAIL — `Cannot find module '~~/server/services/workouts.service'`

**Step 4: Create `WorkoutsService`**

Create `server/services/workouts.service.ts` by moving `buildActiveSession` and `buildTodaysWorkout` out of `HomeService` (`server/services/home.service.ts:104-138`) verbatim, plus the `TrainingDay` type alias and the `startOfWeek`/training-days-lookup logic needed to find the active block:

```ts
import { BaseService } from '~~/server/services/base.service'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { ActiveSessionSummary, TodaysWorkout } from '~~/shared/types/home.types'
import type { WorkoutsSummary } from '~~/shared/types/workouts.types'
import type { WorkoutSession } from '~~/shared/types/session.types'
import type { SplitDay, SplitExercise } from '~~/shared/types/split.types'

const RECENT_SESSIONS_LIMIT = 5
const RECENT_PRS_LIMIT = 5

type TrainingDay = SplitDay & { exercises: SplitExercise[] }

export class WorkoutsService extends BaseService {
  constructor(
    ctx: RequestContext,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
    private exercises: ExerciseRepository,
    private xp: XpRepository,
  ) {
    super(ctx)
  }

  async getSummary(): Promise<WorkoutsSummary> {
    const userId = this.ctx.userId
    const todayIso = new Date().toISOString().slice(0, 10)

    const [activeBlock, activeSessionRow] = await Promise.all([
      this.blocks.findActiveForUser(userId, todayIso),
      this.sessions.findActiveForUser(userId),
    ])

    const trainingDays: TrainingDay[] = (activeBlock?.days.filter(day => !day.isRestDay) ?? [])
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)

    const [activeSession, todaysWorkout, recentSessions, recentPrs] = await Promise.all([
      this.buildActiveSession(activeSessionRow),
      this.buildTodaysWorkout(userId, trainingDays, activeSessionRow),
      this.sessions.findRecentCompletedSummaries(userId, RECENT_SESSIONS_LIMIT),
      this.xp.recentPrs(userId, RECENT_PRS_LIMIT),
    ])

    return { todaysWorkout, activeSession, recentSessions, recentPrs }
  }

  async buildActiveSession(session: WorkoutSession | null): Promise<ActiveSessionSummary | null> {
    if (!session) return null
    const withLogs = await this.sessions.findWithLogs(session.id)
    const setsLogged = withLogs?.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) ?? 0
    return { sessionId: session.id, splitDayId: session.splitDayId, startedAt: session.startedAt, setsLogged }
  }

  async buildTodaysWorkout(
    userId: string,
    trainingDays: TrainingDay[],
    activeSession: WorkoutSession | null,
  ): Promise<TodaysWorkout | null> {
    if (trainingDays.length === 0) return null

    let day = activeSession?.splitDayId ? trainingDays.find(d => d.id === activeSession.splitDayId) : undefined
    if (!day) {
      const lastSplitDayId = await this.sessions.findMostRecentSplitDayId(userId, trainingDays.map(d => d.id))
      const lastIndex = lastSplitDayId ? trainingDays.findIndex(d => d.id === lastSplitDayId) : -1
      day = trainingDays[(lastIndex + 1) % trainingDays.length]
    }
    if (!day) return null

    const names = await this.exercises.findNamesByIds(day.exercises.map(exercise => exercise.exerciseId))
    return {
      splitDayId: day.id,
      blockId: day.blockId,
      dayName: day.name,
      exercises: day.exercises.map(exercise => ({
        exerciseId: exercise.exerciseId,
        exerciseName: names[exercise.exerciseId] ?? exercise.exerciseId,
        splitExerciseId: exercise.id,
        position: exercise.position,
        setType: exercise.setType,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        targetRpe: exercise.targetRpe,
      })),
    }
  }
}
```

Note `buildActiveSession`/`buildTodaysWorkout` are `public` here (no `private`) — `HomeService` needs to call them in Task 4's `getTrainingDaysForActiveBlock`-style reuse below.

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/services/workouts.service.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add server/services/workouts.service.ts shared/types/workouts.types.ts tests/server/services/workouts.service.test.ts
git commit -m "feat(workouts): add WorkoutsService for today's-workout/active-session logic"
```

---

## Task 4: Make `HomeService` depend on `WorkoutsService`

**Files:**
- Modify: `server/services/home.service.ts`
- Modify: `server/api/home/index.get.ts`
- Test: `tests/server/services/home.service.test.ts` (new file)

**Step 1: Write a characterization test for `HomeService` first**

There is no existing `home.service.test.ts` — before refactoring, pin down current behavior so the refactor can't silently break it. Create `tests/server/services/home.service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'
import { HomeService } from '~~/server/services/home.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

function ctx(userId = 'user-1'): RequestContext {
  return { userId, roles: [], permissions: [] }
}

describe('HomeService', () => {
  let db: Client
  let service: HomeService

  beforeEach(async () => {
    db = await createTestDb()
    const sessions = new SessionRepository(db)
    const blocks = new BlockRepository(db)
    const exercises = new ExerciseRepository(db)
    const xp = new XpRepository(db)
    const workouts = new WorkoutsService(ctx(), sessions, blocks, exercises, xp)
    service = new HomeService(ctx(), sessions, blocks, new StreakRepository(db), xp, new AchievementRepository(db), exercises, new BodyMetricsRepository(db), workouts)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  })

  it('returns a summary with null todaysWorkout/activeSession when there is no active block', async () => {
    const summary = await service.getSummary()
    expect(summary.todaysWorkout).toBeNull()
    expect(summary.activeSession).toBeNull()
    expect(summary.streak).toEqual({ current: 0, longest: 0 })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/services/home.service.test.ts`
Expected: FAIL — `HomeService` constructor doesn't accept a 9th `workouts` argument yet (TS error) — this is expected; it documents the target shape before you build it.

**Step 3: Refactor `HomeService`**

In `server/services/home.service.ts`:
- Add `private workouts: WorkoutsService` as a new constructor parameter (last position, matching the test above), with `import type { WorkoutsService } from '~~/server/services/workouts.service'`.
- Delete the `buildActiveSession` and `buildTodaysWorkout` private methods entirely (lines 104-138) — they now live on `WorkoutsService`.
- Delete the now-unused `TrainingDay` type alias, `ExerciseRepository` import (check if `this.exercises` is still used elsewhere in the file before removing the field/import — it likely is only used inside the deleted `buildTodaysWorkout`, so remove the constructor parameter and import too if so), and `SplitDay`/`SplitExercise`/`WorkoutSession` imports if nothing else in the file uses them.
- In `getSummary()`, replace the two calls with:

```ts
    const [activeSession, todaysWorkout, weeklyTrainedDays, weeklyVolumeKg, recentSession, recentPrs, recentAchievements, bodyMetrics, trainedDates] = await Promise.all([
      this.workouts.buildActiveSession(activeSessionRow),
      this.workouts.buildTodaysWorkout(userId, trainingDays, activeSessionRow),
      this.sessions.countTrainedDaysInRange(userId, toSqliteDatetime(weekStart), toSqliteDatetime(weekEnd)),
      this.sessions.volumeKgInRange(userId, toSqliteDatetime(weekStart), toSqliteDatetime(weekEnd)),
      this.sessions.findMostRecentCompletedSummary(userId),
      this.xp.recentPrs(userId, RECENT_PRS_LIMIT),
      this.achievements.findRecentlyUnlocked(userId, RECENT_ACHIEVEMENTS_LIMIT),
      this.bodyMetrics.findForUser(userId),
      this.sessions.findTrainedDatesInRange(userId, toSqliteDatetime(consistencyStart), toSqliteDatetime(consistencyEnd)),
    ])
```

(`trainingDays` is still computed the same way, from `activeBlock` — that part of `getSummary` doesn't change, only the two calls that used to be private methods.)

**Step 4: Update the route that constructs `HomeService`**

In `server/api/home/index.get.ts`, construct a `WorkoutsService` and pass it in:

```ts
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'
import { HomeService } from '~~/server/services/home.service'

// ...defineRouteMeta unchanged...

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const sessions = new SessionRepository(db)
  const blocks = new BlockRepository(db)
  const exercises = new ExerciseRepository(db)
  const xp = new XpRepository(db)
  const workouts = new WorkoutsService(ctx, sessions, blocks, exercises, xp)
  const service = new HomeService(
    ctx,
    sessions,
    blocks,
    new StreakRepository(db),
    xp,
    new AchievementRepository(db),
    exercises,
    new BodyMetricsRepository(db),
    workouts,
  )
  return service.getSummary()
})
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/services/home.service.test.ts tests/server/services/workouts.service.test.ts`
Expected: PASS

**Step 6: Run the full suite and typecheck**

Run: `npx vue-tsc --noEmit -p . && npx vitest run`
Expected: no type errors, all tests pass — this refactor must not change `/api/home`'s output shape at all, only where the logic for two of its fields lives.

**Step 7: Commit**

```bash
git add server/services/home.service.ts server/api/home/index.get.ts tests/server/services/home.service.test.ts
git commit -m "refactor(home): delegate today's-workout/active-session to WorkoutsService"
```

---

## Task 5: `GET /api/workouts` endpoint

**Files:**
- Create: `server/api/workouts/index.get.ts`

**Step 1: Implement**

Mirror `server/api/home/index.get.ts`'s structure exactly:

```ts
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get the workouts page summary',
    description: 'Today\'s scheduled day (or in-progress session), and recent completed sessions/PRs.',
    responses: {
      200: { description: 'Workouts summary' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new WorkoutsService(
    ctx,
    new SessionRepository(db),
    new BlockRepository(db),
    new ExerciseRepository(db),
    new XpRepository(db),
  )
  return service.getSummary()
})
```

**Step 2: Manual verification**

Run: `npm run dev` (if not already running)

In another terminal, log in as the seeded test user and hit the route with its session cookie — easiest via a browser: log in at `http://localhost:3000/login` with `test-user@hadeed.dev` / `password123`, then in the same browser tab visit `http://localhost:3000/api/workouts` directly and confirm it returns JSON with `todaysWorkout`, `activeSession`, `recentSessions`, `recentPrs` keys (matching `WorkoutsSummary`).

**Step 3: Commit**

```bash
git add server/api/workouts/index.get.ts
git commit -m "feat(workouts): add GET /api/workouts endpoint"
```

---

## Task 6: `GET /api/sessions/[id]` endpoint

There is currently no way to fetch a session's full exercise/set data — `findWithLogs` exists on `SessionRepository` but nothing exposes it. The session-logging page needs this.

**Files:**
- Create: `server/api/sessions/[id].get.ts`

**Step 1: Implement**

Mirror the ownership-check pattern already used in `server/api/sessions/[id]/exercises.post.ts`:

```ts
import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Get a session with its exercises and sets',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: { description: 'The session with nested exercise logs and set logs' },
      403: { description: 'Session is not owned by the caller' },
      404: { description: 'Session not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const id = getRouterParam(event, 'id')!
  const repo = new SessionRepository(useDb())

  const session = await repo.findWithLogs(id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  if (session.userId !== ctx.userId) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

  return session
})
```

**Step 2: Manual verification**

With the dev server running and logged in as `test-user@hadeed.dev` in a browser, find an existing session id for that user (query the seeded DB, or start one via the UI once Task 9's composable exists — for now, check `tests/server/repositories/session.repository.test.ts` for a `startSession` call you can replicate via `curl` with the session cookie copied from the browser's dev tools, or just defer full manual verification of this route to Task 16 where the session page actually calls it end-to-end). At minimum confirm the route compiles and returns 404 for a bogus id: visit `http://localhost:3000/api/sessions/nonexistent-id` and confirm a 404 JSON error.

**Step 3: Commit**

```bash
git add "server/api/sessions/[id].get.ts"
git commit -m "feat(sessions): add GET /api/sessions/[id] to fetch a session with its logs"
```

---

## Task 7: Query keys for workouts/session

**Files:**
- Modify: `app/composables/query-keys.ts`

**Step 1: Add the two new keys**

```ts
export const queryKeys = {
  profile: () => ['profile'] as const,
  home: () => ['home'] as const,
  hydration: () => ['hydration'] as const,
  exercise: (id: string) => ['exercise', id] as const,
  exerciseHistory: (id: string) => ['exercise-history', id] as const,
  presetSplits: () => ['preset-splits'] as const,
  presetSplitsRecommend: (input: RecommendationInput) => ['preset-splits', 'recommend', input] as const,
  nutrition: () => ['nutrition'] as const,
  ingredients: () => ['ingredients'] as const,
  presetMeals: () => ['preset-meals'] as const,
  workouts: () => ['workouts'] as const,
  session: (id: string) => ['session', id] as const,
}
```

**Step 2: Typecheck**

Run: `npx vue-tsc --noEmit -p .`
Expected: no errors

**Step 3: Commit**

```bash
git add app/composables/query-keys.ts
git commit -m "feat(workouts): add query keys for workouts summary and session"
```

---

## Task 8: `useWorkoutsSummary` composable

**Files:**
- Create: `app/composables/useWorkoutsSummary.ts`

**Step 1: Implement**

Mirror `app/composables/useHomeStats.ts` exactly:

```ts
import type { FetchError } from 'ofetch'
import type { WorkoutsSummary } from '~~/shared/types/workouts.types'
import { useQuery } from '@pinia/colada'

export const useWorkoutsSummary = () => {
  const { $api } = useNuxtApp()

  return useQuery<WorkoutsSummary, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.workouts(),
    query: () => $api<WorkoutsSummary>('/api/workouts'),
  })
}
```

**Step 2: Typecheck**

Run: `npx vue-tsc --noEmit -p .`

**Step 3: Commit**

```bash
git add app/composables/useWorkoutsSummary.ts
git commit -m "feat(workouts): add useWorkoutsSummary composable"
```

---

## Task 9: `useSession` composable

**Files:**
- Create: `app/composables/useSession.ts`

**Step 1: Implement**

```ts
import type { FetchError } from 'ofetch'
import type { WorkoutSessionWithLogs } from '~~/shared/types/session.types'
import { useQuery } from '@pinia/colada'

export const useSession = (id: MaybeRefOrGetter<string>) => {
  const { $api } = useNuxtApp()

  return useQuery<WorkoutSessionWithLogs, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.session(toValue(id)),
    query: () => $api<WorkoutSessionWithLogs>(`/api/sessions/${toValue(id)}`),
  })
}
```

`toValue`/`MaybeRefOrGetter` are auto-imported from Vue via Nuxt. Check `WorkoutSessionWithLogs`'s exact export name in `shared/types/session.types.ts` before using it — it was referenced as the return type of `findWithLogs` in `server/repositories/session.repository.ts`.

**Step 2: Typecheck**

Run: `npx vue-tsc --noEmit -p .`

**Step 3: Commit**

```bash
git add app/composables/useSession.ts
git commit -m "feat(workouts): add useSession composable for a single session's logs"
```

---

## Task 10: Session-lifecycle mutation composables

**Files:**
- Create: `app/composables/useStartSession.ts`
- Create: `app/composables/useLogSet.ts`
- Create: `app/composables/useEditSetLog.ts`
- Create: `app/composables/useCompleteSession.ts`

**Step 1: `useStartSession`**

Generates the client-side session id (per the 2026-08-21 design's client-generated-UUID requirement) and invalidates the workouts summary on success:

```ts
import type { FetchError } from 'ofetch'
import type { StartSessionInput } from '~~/server/repositories/session.repository'
import type { WorkoutSession } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useStartSession = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<WorkoutSession, Omit<StartSessionInput, 'id'>, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<WorkoutSession>('/api/sessions', {
      method: 'POST',
      body: { ...input, id: crypto.randomUUID() },
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.workouts() }),
  })
}
```

**Step 2: `useLogSet`**

```ts
import type { FetchError } from 'ofetch'
import type { SetLog } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface LogSetPayload {
  sessionId: string
  exerciseLogId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rpe: number | null
}

export const useLogSet = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<SetLog, LogSetPayload, FetchError<{ statusMessage: string }>>({
    mutation: ({ sessionId, ...input }) => $api<SetLog>(`/api/sessions/${sessionId}/sets`, {
      method: 'POST',
      body: { ...input, id: crypto.randomUUID() },
    }),
    onSuccess: (_result, { sessionId }) => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
      queryCache.invalidateQueries({ key: queryKeys.workouts() }),
    ]),
  })
}
```

**Step 3: `useEditSetLog`**

```ts
import type { FetchError } from 'ofetch'
import type { SetLog } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface EditSetLogPayload {
  sessionId: string
  setLogId: string
  expectedVersion: number
  weightKg?: number | null
  reps?: number | null
  rpe?: number | null
}

export const useEditSetLog = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<SetLog, EditSetLogPayload, FetchError<{ statusMessage: string }>>({
    mutation: ({ sessionId, setLogId, ...body }) => $api<SetLog>(`/api/sessions/${sessionId}/sets/${setLogId}`, {
      method: 'PATCH',
      body,
    }),
    onSuccess: (_result, { sessionId }) => queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
  })
}
```

(A 409 conflict response surfaces to the caller as a thrown `FetchError` with `statusCode: 409` — per the design doc, this pass just lets that error propagate to the UI as an error state, no resolution flow.)

**Step 4: `useCompleteSession`**

```ts
import type { FetchError } from 'ofetch'
import type { WorkoutSession } from '~~/shared/types/session.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useCompleteSession = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<WorkoutSession, { sessionId: string, expectedVersion: number }, FetchError<{ statusMessage: string }>>({
    mutation: ({ sessionId, expectedVersion }) => $api<WorkoutSession>(`/api/sessions/${sessionId}/complete`, {
      method: 'POST',
      body: { expectedVersion },
    }),
    onSuccess: (_result, { sessionId }) => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
      queryCache.invalidateQueries({ key: queryKeys.workouts() }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
    ]),
  })
}
```

**Step 5: Typecheck**

Run: `npx vue-tsc --noEmit -p .`
Expected: no errors — if `SetLog`/`WorkoutSession` aren't exported from `shared/types/session.types.ts` under those exact names, fix the import to match what's actually exported there.

**Step 6: Commit**

```bash
git add app/composables/useStartSession.ts app/composables/useLogSet.ts app/composables/useEditSetLog.ts app/composables/useCompleteSession.ts
git commit -m "feat(workouts): add session lifecycle mutation composables"
```

---

## Task 11: Extract `ExerciseDetailDrawer.vue`

Move the entire drawer content currently inline in `workouts.vue` (lines 78-315 — everything inside `<UiDrawer>...</UiDrawer>`) into its own component, changing nothing about its behavior, so it can be reused from both the rewritten landing page and the new session page.

**Files:**
- Create: `app/components/exercise/ExerciseDetailDrawer.vue`
- Modify: `app/pages/workouts.vue` (temporarily, fully replaced again in Task 15 — this task just proves the extraction works)

**Step 1: Create the component**

Create `app/components/exercise/ExerciseDetailDrawer.vue`. It should accept the exercise id as a prop and control its own open state via `v-model`, since callers (landing page's exercise list, session page's per-exercise info tap) just need to say *which* exercise and *whether it's open*:

```vue
<script setup lang="ts">
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  HistoryIcon,
  InfoIcon,
  PersonStandingIcon,
  PlusIcon,
  TrophyIcon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { CarouselApi } from "@/components/ui/carousel";
import { kgToLbs } from "~~/shared/lib/formulas";

const props = defineProps<{ exerciseId: string }>();
const open = defineModel<boolean>("open", { default: false });

const exerciseId = toRef(props, "exerciseId");
const { data: exercise, refetch } = useExercise(exerciseId);
const { data: exerciseHistory } = useExerciseHistory(exerciseId);
const { data: profileData } = useProfile();

const personalRecord = computed(() => exerciseHistory.value?.personalRecord ?? null);
const history = computed(() => exerciseHistory.value?.history ?? []);

const activeImageIndex = ref(0);
const onImageCarouselInit = (api: CarouselApi) => {
  if (!api) return;
  activeImageIndex.value = api.selectedScrollSnap();
  api.on("select", () => {
    activeImageIndex.value = api.selectedScrollSnap();
  });
};

const parsedInstructions = computed(() => {
  if (!exercise.value) return [];
  return exercise.value.instructions.map((step) => {
    const match = step.match(/\s*Tip:\s*(.+)$/);
    return match
      ? { text: step.slice(0, match.index).trim(), tip: (match[1] ?? "").trim() }
      : { text: step, tip: null };
  });
});

watch(open, (isOpen) => {
  if (isOpen) refetch();
});

const titleCase = (value: string): string => {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
};

const formatWeight = (weightKg: number): string => {
  if (profileData.value?.profile?.unitSystem === "imperial") {
    return `${Math.round(kgToLbs(weightKg))} lbs`;
  }
  return `${Math.round(weightKg)} kg`;
};

const formatHistoryDate = (dateString: string): string => {
  const date = new Date(`${dateString.replace(" ", "T")}Z`);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};
</script>

<template>
  <UiDrawer v-model:open="open">
    <UiDrawerContent>
      <!-- paste the full contents of the old workouts.vue's <div class="flex flex-col gap-8 ..."> through
           its matching closing </div>, and the <UiDrawerFooter>...</UiDrawerFooter> after it, UNCHANGED --></UiDrawerContent>
  </UiDrawer>
</template>
```

Everything between `<UiDrawerContent>` and its close is a verbatim copy-paste from the current `workouts.vue` (the `<div class="flex flex-col gap-8 overflow-y-auto p-5 pt-6">...</div>` block and the `<UiDrawerFooter>` after it) — don't rewrite any of it, this task is a pure extraction. Drop the old `<UiDrawerTrigger>`/`Stepper` button entirely; this component no longer owns its own trigger, callers control `open` via `v-model:open`.

**Step 2: Prove the extraction works**

Temporarily replace all of `app/pages/workouts.vue` with a minimal harness just to verify the extracted component renders identically to before:

```vue
<script setup lang="ts">
const drawerOpen = ref(true);
</script>

<template>
  <main class="mx-auto max-w-xl p-8">
    <ExerciseDetailDrawer v-model:open="drawerOpen" exercise-id="Barbell_Bench_Press_-_Medium_Grip" />
  </main>
</template>
```

Run: `npm run dev`, log in as `test-user@hadeed.dev`, navigate to `/workouts`, and confirm the drawer opens automatically showing the bench press detail (image carousel, PR card if any, execution steps, muscle map, history) exactly as it did before the extraction. Take a screenshot if you want a visual diff against the pre-extraction state.

**Step 3: Commit**

```bash
git add app/components/exercise/ExerciseDetailDrawer.vue app/pages/workouts.vue
git commit -m "refactor(workouts): extract ExerciseDetailDrawer as a reusable component"
```

(`workouts.vue` stays as this minimal harness only until Task 15 replaces it with the real landing page — don't worry about it being incomplete in between these two commits.)

---

## Task 12: Landing page — "Today" card

**Files:**
- Modify: `app/pages/workouts.vue`

**Step 1: Build the three-state Today card**

Replace the harness from Task 11 with the real page shell and the Today card. Use `useWorkoutsSummary` for data, `useStartSession` for starting:

```vue
<script setup lang="ts">
import { PlayIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";

const { data: summary, isLoading } = useWorkoutsSummary();
const startSession = useStartSession();

const startWorkout = async () => {
  const workout = summary.value?.todaysWorkout;
  if (!workout) return;
  const session = await startSession.mutateAsync({
    splitDayId: workout.splitDayId,
    exercises: workout.exercises.map(exercise => ({
      id: crypto.randomUUID(),
      exerciseId: exercise.exerciseId,
      splitExerciseId: exercise.splitExerciseId,
      position: exercise.position,
      setType: exercise.setType,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      targetRpe: exercise.targetRpe,
    })),
  });
  await navigateTo(`/workouts/session/${session.id}`);
};

const resumeWorkout = async () => {
  const sessionId = summary.value?.activeSession?.sessionId;
  if (!sessionId) return;
  await navigateTo(`/workouts/session/${sessionId}`);
};
</script>

<template>
  <div class="px-4 py-4 flex flex-col gap-y-4" v-if="!isLoading">
    <span class="font-mono text-muted-foreground">{{ useDateFormat(useNow(), "MMM DD, YYYY") }}</span>
    <h1 class="font-heading text-3xl font-semibold text-foreground">Workouts</h1>

    <UiCard v-if="summary?.activeSession" class="space-y-3">
      <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">In Progress</span>
      <p class="font-heading text-2xl font-semibold text-foreground">
        {{ summary.todaysWorkout?.dayName ?? "Freeform Workout" }}
      </p>
      <p class="text-sm text-muted-foreground">{{ summary.activeSession.setsLogged }} sets logged</p>
      <Button size="lg" class="w-full" @click="resumeWorkout">
        <PlayIcon class="size-4" />
        Continue Workout
      </Button>
    </UiCard>

    <UiCard v-else-if="summary?.todaysWorkout" class="space-y-3">
      <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">Today</span>
      <p class="font-heading text-2xl font-semibold text-foreground">{{ summary.todaysWorkout.dayName }}</p>
      <ul class="space-y-1 text-sm text-muted-foreground">
        <li v-for="exercise in summary.todaysWorkout.exercises" :key="exercise.splitExerciseId">
          {{ exercise.exerciseName }}
          <span v-if="exercise.targetSets">— {{ exercise.targetSets }}×{{ exercise.targetReps }}</span>
        </li>
      </ul>
      <Button size="lg" class="w-full" :disabled="startSession.isLoading.value" @click="startWorkout">
        <PlayIcon class="size-4" />
        Start Workout
      </Button>
    </UiCard>

    <UiCard v-else class="space-y-2">
      <p class="font-heading text-xl text-foreground">No active program</p>
      <p class="text-sm text-muted-foreground">Set up a training split to see today's workout here.</p>
    </UiCard>
  </div>
</template>
```

Check `StartSessionInput`'s exact field names in `server/repositories/session.repository.ts:15-30` before finalizing `startWorkout`'s payload shape — match them exactly (this plan's draft above is written from that same interface, but re-verify since Task 2 changed the exercise shape upstream).

**Step 2: Manual verification**

Run: `npm run dev`, log in as `test-user@hadeed.dev` (seeded with an active block, per `server/database/seed-dummy.ts`), navigate to `/workouts`.
Expected: the Today card shows a real scheduled day's name and exercise list with a "Start Workout" button (or "Continue Workout" if a session is already in progress from earlier testing — if so, first complete or let it go stale, or test with `test-user-2@hadeed.dev`/`test-user-3@hadeed.dev` instead). Click Start Workout and confirm it navigates to `/workouts/session/<some-uuid>` (a 404/blank page is expected until Task 16 builds that route — that's fine for this step, you're only verifying the start-and-navigate happens).

Also check `test-user-empty@hadeed.dev` (no active block) shows the "No active program" empty state without errors.

**Step 3: Commit**

```bash
git add app/pages/workouts.vue
git commit -m "feat(workouts): build the Today card (start/resume/empty states)"
```

---

## Task 13: Landing page — Recent PRs row

**Files:**
- Modify: `app/pages/workouts.vue`

**Step 1: Add the section**

Style after the Personal Record card already in `ExerciseDetailDrawer.vue` (trophy icon, primary accent), condensed for a horizontal scroll row. Add below the Today card:

```vue
    <div v-if="summary?.recentPrs.length" class="space-y-2">
      <h2 class="font-heading text-lg uppercase text-foreground">Recent PRs</h2>
      <div class="flex gap-3 overflow-x-auto pb-1">
        <UiCard
          v-for="pr in summary.recentPrs"
          :key="`${pr.exerciseName}-${pr.achievedAt}`"
          class="flex w-44 shrink-0 items-center gap-3"
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <TrophyIcon class="size-4" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-foreground">{{ pr.exerciseName }}</p>
            <p class="text-xs text-muted-foreground">{{ pr.weightKg }}kg × {{ pr.reps }}</p>
          </div>
        </UiCard>
      </div>
    </div>
```

Add `TrophyIcon` to the `@lucide/vue` import list at the top of the script block.

**Step 2: Manual verification**

With the dev server running, check `test-user@hadeed.dev`'s `/workouts` page — the seed script logs enough sets over 4 weeks of history that at least one PR should exist (a new heaviest weight for some exercise). Confirm the row renders and scrolls horizontally if it overflows.

**Step 3: Commit**

```bash
git add app/pages/workouts.vue
git commit -m "feat(workouts): add Recent PRs row to the landing page"
```

---

## Task 14: Landing page — Recent Sessions list

**Files:**
- Modify: `app/pages/workouts.vue`

**Step 1: Add the section**

Reuse the same card shape as Home's "Last Session" card (`app/pages/index.vue` — search for `LAST SESSION`/`lastSession` to find it), repeated as a list. You'll need the same `formatWeight`/relative-time logic — copy the `formatWeight` helper and a per-item `useTimeAgo` the same way `index.vue` does it (or, if you'd rather not duplicate `formatWeight` a third time across pages, that's a reasonable follow-up cleanup but out of scope for this task — match the existing per-page-duplication convention already established by `workouts.vue`'s own pre-existing `formatWeight`, wait — `workouts.vue` no longer has one after Task 11's extraction moved it into `ExerciseDetailDrawer.vue`. Re-add a local `formatWeight` to `workouts.vue`'s script block, identical to the one in `ExerciseDetailDrawer.vue`):

```vue
    <div v-if="summary?.recentSessions.length" class="space-y-2">
      <h2 class="font-heading text-lg uppercase text-foreground">Recent Sessions</h2>
      <UiCard v-for="session in summary.recentSessions" :key="session.sessionId" class="space-y-1">
        <div class="flex items-start justify-between">
          <p class="font-heading text-lg text-foreground">{{ session.dayName ?? "Freeform Workout" }}</p>
          <span v-if="session.durationMinutes" class="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {{ Math.round(session.durationMinutes) }}m
          </span>
        </div>
        <p class="text-sm text-muted-foreground">
          {{ formatHistoryDate(session.completedAt) }}
          <template v-if="session.topExerciseName">
            • Top Lift: {{ formatWeight(session.topWeightKg ?? 0) }} {{ session.topExerciseName }}
          </template>
        </p>
      </UiCard>
    </div>
```

Add a `formatHistoryDate` helper to `workouts.vue`'s script (same as the one already in `ExerciseDetailDrawer.vue` — copy it) for the date formatting, and the `formatWeight` helper mentioned above.

**Step 2: Manual verification**

Check `/workouts` for `test-user@hadeed.dev` shows a handful of past sessions with day names, durations, and top lifts, matching what `findRecentCompletedSummaries` returns (cross-check against the DB if anything looks off).

**Step 3: Commit**

```bash
git add app/pages/workouts.vue
git commit -m "feat(workouts): add Recent Sessions list to the landing page"
```

---

## Task 15: Session logging page — shell, timer, exercise list

**Files:**
- Create: `app/pages/workouts/session/[id].vue`

**Step 1: Build the page**

```vue
<script setup lang="ts">
import { CheckIcon, InfoIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const route = useRoute();
const sessionId = computed(() => route.params.id as string);

const { data: session, refetch } = useSession(sessionId);
const logSet = useLogSet();
const completeSession = useCompleteSession();

const now = useNow({ interval: 1000 });
const elapsed = computed(() => {
  if (!session.value) return "0:00";
  const startedAt = new Date(`${session.value.startedAt.replace(" ", "T")}Z`);
  const totalSeconds = Math.max(0, Math.floor((now.value.getTime() - startedAt.getTime()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

const drafts = reactive<Record<string, { weightKg: string, reps: string, rpe: string }>>({});
const draftFor = (exerciseLogId: string) => {
  drafts[exerciseLogId] ??= { weightKg: "", reps: "", rpe: "" };
  return drafts[exerciseLogId];
};

const infoDrawerOpen = ref(false);
const infoExerciseId = ref("");
const openInfo = (exerciseId: string) => {
  infoExerciseId.value = exerciseId;
  infoDrawerOpen.value = true;
};

const logNextSet = async (exerciseLogId: string) => {
  const exercise = session.value?.exercises.find(e => e.id === exerciseLogId);
  if (!exercise) return;
  const draft = draftFor(exerciseLogId);
  await logSet.mutateAsync({
    sessionId: sessionId.value,
    exerciseLogId,
    setNumber: exercise.sets.length + 1,
    weightKg: draft.weightKg === "" ? null : Number(draft.weightKg),
    reps: draft.reps === "" ? null : Number(draft.reps),
    rpe: draft.rpe === "" ? null : Number(draft.rpe),
  });
  draft.weightKg = "";
  draft.reps = "";
  draft.rpe = "";
};

const finish = async () => {
  if (!session.value) return;
  try {
    await completeSession.mutateAsync({ sessionId: sessionId.value, expectedVersion: session.value.version });
    await navigateTo("/workouts");
  } catch {
    await refetch();
  }
};
</script>

<template>
  <div v-if="session" class="flex flex-col gap-y-4 px-4 py-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">{{ elapsed }}</p>
        <h1 class="font-heading text-2xl font-semibold text-foreground">
          {{ session.splitDayId ? "Workout" : "Freeform Workout" }}
        </h1>
      </div>
      <Button :disabled="completeSession.isLoading.value" @click="finish">Finish</Button>
    </div>

    <UiCard v-for="exercise in session.exercises" :key="exercise.id" class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="font-heading text-lg text-foreground">{{ exercise.exerciseId }}</p>
        <button @click="openInfo(exercise.exerciseId)"><InfoIcon class="size-4 text-muted-foreground" /></button>
      </div>

      <div v-for="set in exercise.sets" :key="set.id" class="flex items-center gap-3 text-sm text-muted-foreground">
        <span class="w-6">{{ set.setNumber }}</span>
        <span>{{ set.weightKg ?? "–" }}kg</span>
        <span>{{ set.reps ?? "–" }} reps</span>
        <span v-if="set.rpe">RPE {{ set.rpe }}</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="w-6 text-sm text-muted-foreground">{{ exercise.sets.length + 1 }}</span>
        <Input v-model="draftFor(exercise.id).weightKg" type="number" placeholder="kg" class="w-20" />
        <Input v-model="draftFor(exercise.id).reps" type="number" placeholder="reps" class="w-20" />
        <Input v-model="draftFor(exercise.id).rpe" type="number" placeholder="RPE" class="w-16" />
        <Button size="icon" :disabled="logSet.isLoading.value" @click="logNextSet(exercise.id)">
          <CheckIcon class="size-4" />
        </Button>
      </div>
    </UiCard>

    <ExerciseDetailDrawer v-model:open="infoDrawerOpen" :exercise-id="infoExerciseId" />
  </div>
</template>
```

`exercise.exerciseId` is a raw id like `Barbell_Bench_Press_-_Medium_Grip`, not a display name — `WorkoutSessionWithLogs.exercises[]` doesn't carry a friendly name today. Displaying the raw id is a known rough edge for this task (it's still functional and unblocked), OR resolve it properly: check whether `useExercise` from `ExerciseDetailDrawer.vue` can be reused per-row to fetch the display name (it's a per-exercise query already used inside the drawer, so calling it again per row here is redundant network-wise; a cleaner fix is adding exercise names into `findWithLogs`'s response server-side, which is a small follow-up to `SessionRepository.findWithLogs`/`mapExerciseLog` — do this now if it's a small change, otherwise leave the raw id and note it as a known gap in your final report). Confirm which approach you took either way.

**Step 2: Manual verification**

From `/workouts`, click "Start Workout" for `test-user@hadeed.dev`. Confirm you land on `/workouts/session/<id>` showing the exercise list from today's split day, the elapsed timer ticking up, and that entering weight/reps/RPE and clicking the checkmark adds a logged-set row and clears the inputs. Tap the info icon and confirm `ExerciseDetailDrawer` opens with that exercise's detail. Click Finish before all target sets are logged and confirm it fails gracefully (the `isComplete` check on the backend rejects with a 422 — confirm the UI doesn't crash, even if you haven't built a dedicated error message for this case; note it as a rough edge if so). Log enough sets to satisfy the day's targets, click Finish again, and confirm it navigates back to `/workouts`.

**Step 3: Commit**

```bash
git add "app/pages/workouts/session/[id].vue"
git commit -m "feat(workouts): add session logging page"
```

---

## Task 16: Full regression pass

**Files:** none (verification only)

**Step 1: Typecheck and test**

Run: `npx vue-tsc --noEmit -p . && npx vitest run`
Expected: no type errors, all tests pass.

**Step 2: Browser smoke test**

With `npm run dev` running, walk through, for `test-user@hadeed.dev`:
1. `/` (Home) still renders correctly — confirm the "Last Session" card and Consistency grid still work (they now indirectly depend on `WorkoutsService` via `HomeService`).
2. `/workouts` shows Today card + Recent PRs + Recent Sessions.
3. Start a workout, log sets, view exercise info via the drawer, finish it.
4. Back on `/workouts`, confirm the just-finished session now appears in Recent Sessions and the Today card shows the *next* day in rotation.

Also check `test-user-empty@hadeed.dev`: `/workouts` should show the empty state with no console errors.

**Step 3: Report**

Summarize what was built, and explicitly call out the known rough edges from Task 15 (raw exercise id display, and/or the 422-on-incomplete-finish UX) so they're tracked rather than silently shipped.
