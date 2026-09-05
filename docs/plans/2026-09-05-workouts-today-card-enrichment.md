# Today Card Enrichment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich each exercise row on the Workouts landing page's "Today" card with a thumbnail, primary-muscle chip, and a "last performed" line, and let tapping a row open the existing exercise detail drawer.

**Architecture:** Two new batched repository methods (`ExerciseRepository.findByIds`, `SessionRepository.findLastPerformedForExercises`) feed three new fields on the shared `TodaysWorkoutExercise` type, computed once in `WorkoutsService.buildTodaysWorkout` alongside the existing lookups (no client-side waterfall). The frontend swaps a plain `<li>` list for richer rows and mounts the already-built `ExerciseDetailDrawer` for tap-to-expand, following the exact pattern already used in `app/pages/workouts/session/[id].vue`.

**Tech Stack:** Nuxt 4, `@libsql/client` (Turso/libSQL), Vitest.

Design doc: `docs/plans/2026-09-05-workouts-today-card-enrichment-design.md`

---

### Task 1: `ExerciseRepository.findByIds`

**Files:**
- Modify: `server/repositories/exercise.repository.ts`
- Test: `tests/server/repositories/exercise.repository.test.ts`

**Step 1: Write the failing test**

Add to the bottom of the `describe('ExerciseRepository', ...)` block in `tests/server/repositories/exercise.repository.test.ts`:

```ts
  it('batches muscle/image attachment across multiple exercises from findByIds', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await seedExercise(db, 'bench-press', chest.id)
    await seedExercise(db, 'incline-press', chest.id)
    await db.execute({
      sql: 'INSERT INTO exercise_images (exercise_id, url, position) VALUES (?, ?, ?)',
      args: ['incline-press', 'incline.jpg', 0],
    })

    const results = await repo.findByIds(['bench-press', 'incline-press'])

    expect(results.map(e => e.id).sort()).toEqual(['bench-press', 'incline-press'])
    const inclinePress = results.find(e => e.id === 'incline-press')
    expect(inclinePress?.images).toEqual(['incline.jpg'])
    expect(inclinePress?.primaryMuscles).toEqual(['chest'])
  })

  it('findByIds returns an empty array for an empty id list', async () => {
    const results = await repo.findByIds([])
    expect(results).toEqual([])
  })
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/exercise.repository.test.ts`
Expected: FAIL with `repo.findByIds is not a function`

**Step 3: Write minimal implementation**

In `server/repositories/exercise.repository.ts`, add this method right after `findByMuscle` (before `findNamesByIds`):

```ts
  async findByIds(ids: string[]): Promise<Exercise[]> {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(', ')
    const result = await this.db.execute({
      sql: `SELECT * FROM exercises WHERE id IN (${placeholders})`,
      args: ids,
    })
    const exercises = result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
    return this.attachDetails(exercises)
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/exercise.repository.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add server/repositories/exercise.repository.ts tests/server/repositories/exercise.repository.test.ts
git commit -m "feat(exercises): add batched findByIds to ExerciseRepository"
```

---

### Task 2: `SessionRepository.findLastPerformedForExercises`

**Files:**
- Modify: `server/repositories/session.repository.ts`
- Test: `tests/server/repositories/session.repository.test.ts`

**Step 1: Write the failing test**

Add a new `describe` block at the bottom of `tests/server/repositories/session.repository.test.ts`:

```ts
describe('SessionRepository.findLastPerformedForExercises', () => {
  let db: Client
  let sessions: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('squat', 'Squat', '[]')" })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench', 'Bench', '[]')" })
  })

  it('returns the top set from the most recent session per exercise, not the heaviest ever', async () => {
    // Older session: heavier squat set.
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 's1-squat', sessionId: 's1', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 's1-squat-set', exerciseLogId: 's1-squat', setNumber: 1, weightKg: 140, reps: 3, rpe: 9 })
    await sessions.completeSession('s1', 1)
    await db.execute({ sql: `UPDATE workout_sessions SET started_at = '2026-01-01 12:00:00', completed_at = '2026-01-01 12:30:00' WHERE id = 's1'` })

    // Newer session: lighter squat set, should still win because it's more recent.
    await sessions.startSession('user-1', { id: 's2', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 's2-squat', sessionId: 's2', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 's2-squat-set-1', exerciseLogId: 's2-squat', setNumber: 1, weightKg: 100, reps: 5, rpe: 7 })
    // Same weight, more reps - should win the within-session tiebreak.
    await sessions.logSet({ id: 's2-squat-set-2', exerciseLogId: 's2-squat', setNumber: 2, weightKg: 100, reps: 8, rpe: 8 })
    await sessions.completeSession('s2', 1)
    await db.execute({ sql: `UPDATE workout_sessions SET started_at = '2026-01-05 12:00:00', completed_at = '2026-01-05 12:30:00' WHERE id = 's2'` })

    const result = await sessions.findLastPerformedForExercises('user-1', ['squat', 'bench'])

    expect(result.squat).toEqual({ weightKg: 100, reps: 8, date: '2026-01-05 12:30:00' })
    expect(result.bench).toBeUndefined()
  })

  it('breaks a same-timestamp session tie by favoring the later-inserted session', async () => {
    for (const [id, weight] of [['s1', 100], ['s2', 110]] as const) {
      await sessions.startSession('user-1', { id, splitDayId: null, exercises: [] })
      await sessions.addFreeformExercise({ id: `${id}-ex`, sessionId: id, exerciseId: 'squat', position: 0, setType: 'weight_reps' })
      await sessions.logSet({ id: `${id}-set`, exerciseLogId: `${id}-ex`, setNumber: 1, weightKg: weight, reps: 5, rpe: 8 })
      await sessions.completeSession(id, 1)
    }
    await db.execute({ sql: 'UPDATE workout_sessions SET completed_at = ? WHERE id IN (?, ?)', args: ['2026-01-01 12:00:00', 's1', 's2'] })

    const result = await sessions.findLastPerformedForExercises('user-1', ['squat'])

    expect(result.squat?.weightKg).toBe(110)
  })

  it('returns an empty object for an empty exerciseIds array', async () => {
    const result = await sessions.findLastPerformedForExercises('user-1', [])
    expect(result).toEqual({})
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: FAIL with `sessions.findLastPerformedForExercises is not a function`

**Step 3: Write minimal implementation**

In `server/repositories/session.repository.ts`, add this method after `findExerciseHistory`:

```ts
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
                ROW_NUMBER() OVER (
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat(sessions): add batched findLastPerformedForExercises"
```

---

### Task 3: Wire enrichment into `WorkoutsService.buildTodaysWorkout`

**Files:**
- Modify: `shared/types/home.types.ts`
- Modify: `server/services/workouts.service.ts`
- Modify: `server/repositories/exercise.repository.ts` (delete now-dead `findNamesByIds`)
- Test: `tests/server/services/workouts.service.test.ts`

**Step 1: Write the failing test**

Add to `tests/server/services/workouts.service.test.ts`, inside the existing `describe('WorkoutsService', ...)` block, after the `'returns the next unstarted day as todaysWorkout...'` test:

```ts
  it('enriches todaysWorkout exercises with catalog details and last-performed history', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: ['squat', chest.id, 'primary'] })
    await db.execute({ sql: 'INSERT INTO exercise_images (exercise_id, url, position) VALUES (?, ?, ?)', args: ['squat', 'squat.jpg', 0] })

    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 120, reps: 5, rpe: 8 })
    await sessions.completeSession('session-1', 1)

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
    const exercise = summary.todaysWorkout?.exercises[0]

    expect(exercise?.thumbnailUrl).toBe('squat.jpg')
    expect(exercise?.primaryMuscle).toBe('chest')
    expect(exercise?.lastPerformed).toEqual({ weightKg: 120, reps: 5, date: exercise?.lastPerformed?.date })
  })

  it('leaves lastPerformed null for an exercise with no logged history', async () => {
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

    expect(summary.todaysWorkout?.exercises[0]?.lastPerformed).toBeNull()
  })
```

Add the `MuscleRepository` import at the top of the file:

```ts
import { MuscleRepository } from '~~/server/repositories/muscle.repository'
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/services/workouts.service.test.ts`
Expected: FAIL — `exercise?.thumbnailUrl` is `undefined`, not `'squat.jpg'`

**Step 3: Write minimal implementation**

In `shared/types/home.types.ts`, extend `TodaysWorkoutExercise`:

```ts
export interface TodaysWorkoutExercise {
  exerciseId: string
  exerciseName: string
  splitExerciseId: number
  position: number
  setType: SetType
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
  thumbnailUrl: string | null
  primaryMuscle: string | null
  lastPerformed: { weightKg: number, reps: number, date: string } | null
}
```

In `server/services/workouts.service.ts`, replace the body of `buildTodaysWorkout` from the `findNamesByIds` call down:

```ts
    const exerciseIds = day.exercises.map(exercise => exercise.exerciseId)
    const [exerciseDetails, lastPerformed] = await Promise.all([
      this.exercises.findByIds(exerciseIds),
      this.sessions.findLastPerformedForExercises(userId, exerciseIds),
    ])
    const detailsById = new Map(exerciseDetails.map(exercise => [exercise.id, exercise]))

    return {
      splitDayId: day.id,
      blockId: day.blockId,
      dayName: day.name,
      exercises: day.exercises.map((exercise) => {
        const details = detailsById.get(exercise.exerciseId)
        return {
          exerciseId: exercise.exerciseId,
          exerciseName: details?.name ?? exercise.exerciseId,
          splitExerciseId: exercise.id,
          position: exercise.position,
          setType: exercise.setType,
          targetSets: exercise.targetSets,
          targetReps: exercise.targetReps,
          targetRpe: exercise.targetRpe,
          thumbnailUrl: details?.images[0] ?? null,
          primaryMuscle: details?.primaryMuscles[0] ?? null,
          lastPerformed: lastPerformed[exercise.exerciseId] ?? null,
        }
      }),
    }
```

Delete the now-unused `findNamesByIds` method from `server/repositories/exercise.repository.ts` (it has no other callers — confirm with `grep -rn "findNamesByIds" server tests` before deleting).

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/services/workouts.service.test.ts tests/server/services/home.service.test.ts`
Expected: PASS (the `home.service.test.ts` assertions use `toMatchObject`, so the new fields don't break them)

Then run the full suite and typecheck to make sure nothing else references the deleted method:

Run: `npx vitest run && npx vue-tsc --noEmit -p .`
Expected: PASS / no errors

**Step 5: Commit**

```bash
git add shared/types/home.types.ts server/services/workouts.service.ts server/repositories/exercise.repository.ts tests/server/services/workouts.service.test.ts
git commit -m "feat(workouts): enrich todaysWorkout exercises with catalog details and last-performed"
```

---

### Task 4: Richer exercise rows on the Workouts landing page

**Files:**
- Modify: `app/pages/workouts/index.vue`

No automated test for this task (this codebase has no frontend component test infra — verify manually in the browser per the steps below).

**Step 1: Update the script block**

In `app/pages/workouts/index.vue`, update the icon import and add drawer state + handler:

```ts
import { DumbbellIcon, LayoutGridIcon, PlayIcon, TrophyIcon } from "@lucide/vue";
```

Add near the other refs (after `const startError = ref<string | null>(null);`):

```ts
const infoDrawerOpen = ref(false);
const infoExerciseId = ref("");
const openInfo = (exerciseId: string) => {
  infoExerciseId.value = exerciseId;
  infoDrawerOpen.value = true;
};
```

**Step 2: Replace the exercise list markup**

Replace this block (the `<ul>` inside the `v-else-if="summary?.todaysWorkout"` card):

```html
      <ul class="space-y-1 text-sm text-muted-foreground">
        <li v-for="exercise in summary.todaysWorkout.exercises" :key="exercise.splitExerciseId">
          {{ exercise.exerciseName }}
          <span v-if="exercise.targetSets">— {{ exercise.targetSets }}×{{ exercise.targetReps }}</span>
        </li>
      </ul>
```

with:

```html
      <ul class="space-y-2">
        <li
          v-for="exercise in summary.todaysWorkout.exercises"
          :key="exercise.splitExerciseId"
          class="flex cursor-pointer items-center gap-3 rounded-xl border border-surface-strong bg-card p-3"
          @click="openInfo(exercise.exerciseId)"
        >
          <div class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-popover">
            <NuxtImg v-if="exercise.thumbnailUrl" :src="exercise.thumbnailUrl" class="size-full object-cover" />
            <DumbbellIcon v-else class="size-5 text-muted-foreground" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-semibold text-foreground">{{ exercise.exerciseName }}</p>
              <UiBadge
                v-if="exercise.primaryMuscle"
                class="shrink-0 rounded-full bg-popover px-2 py-0.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground"
              >
                {{ exercise.primaryMuscle }}
              </UiBadge>
            </div>
            <p class="text-xs text-muted-foreground">
              <span v-if="exercise.targetSets">{{ exercise.targetSets }}×{{ exercise.targetReps }}</span>
              <template v-if="exercise.lastPerformed">
                · Last: {{ formatWeight(exercise.lastPerformed.weightKg) }} × {{ exercise.lastPerformed.reps }}
                ({{ formatHistoryDate(exercise.lastPerformed.date) }})
              </template>
            </p>
          </div>
        </li>
      </ul>
```

**Step 3: Mount the shared drawer**

At the end of the root `<div class="px-4 py-4 flex flex-col gap-y-4" v-if="!isLoading">` block, right before its closing `</div>` (after the Recent Sessions section), add:

```html
    <ExerciseDetailDrawer v-model:open="infoDrawerOpen" :exercise-id="infoExerciseId" />
```

**Step 4: Typecheck**

Run: `npx vue-tsc --noEmit -p .`
Expected: no errors

**Step 5: Manual verification in the browser**

- Start the dev server if it isn't already running (`npm run dev`).
- Log in, ensure the test user has an active block with today's workout populated and at least one previously-logged session against one of its exercises (seed data or log one manually).
- Load `/workouts`: confirm each exercise row shows a thumbnail (or the dumbbell fallback), a muscle chip when available, and a "Last: ..." line only for the exercise with prior history (the other rows should have no such line, not a placeholder).
- Tap a row: confirm `ExerciseDetailDrawer` opens with that exercise's detail (images/instructions/history), and closes via its Close button.
- Reload the page once more and repeat the tap to confirm no hydration warnings appear in the console (this app has hit SSR hydration issues before with client-only state — check the console explicitly).

**Step 6: Commit**

```bash
git add app/pages/workouts/index.vue
git commit -m "feat(workouts): show thumbnail, muscle, and last-performed on today's exercise rows"
```
