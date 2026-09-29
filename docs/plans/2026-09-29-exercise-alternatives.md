# Exercise Alternatives Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Each split exercise can carry one optional alternative, and a lifter can swap to it
mid-session (before logging a set on it), online or offline.

**Architecture:** A nullable `alternative_exercise_id` on `split_exercises`, snapshotted onto
`exercise_logs` at session start. A swap exchanges `exercise_id` ↔ `alternative_exercise_id` on
the exercise log in one conditional `UPDATE`, and re-snapshots the progression suggestion. The
client queues the swap through the existing outbox as a new `swap_exercise` op, overlaid by
`applyPending` so the page updates instantly.

**Tech Stack:** Nuxt 4, Vue 3, Pinia Colada, libSQL/SQLite, Vitest.

Design: `docs/plans/2026-09-29-exercise-alternatives-design.md`.

Run tests with `npx vitest run <path>`. Never run `db:*` scripts: they use `.env` (production).

---

### Task 1: Schema + split persistence

**Files:**
- Modify: `server/database/schema.sql` (after `ALTER TABLE split_exercises ADD COLUMN rest_seconds`,
  and after the `exercise_logs` suggestion ALTERs)
- Modify: `server/repositories/block.repository.ts` (`CreateSplitExerciseInput`, `createWithDays`, `findWithDays`)
- Modify: `shared/types/split.types.ts` (`SplitExercise.alternativeExerciseId: string | null`)
- Test: `tests/server/repositories/block.repository.test.ts`

**Step 1:** Failing test — `createWithDays` with `alternativeExerciseId: 'db-bench'` on one
exercise and none on another; `findWithDays` returns `'db-bench'` and `null`.

**Step 2:** Run, expect FAIL (column missing).

**Step 3:** Add to schema.sql:

```sql
-- The lifter's planned backup for this exercise (bench taken, machine broken). Snapshotted onto
-- exercise_logs at session start; see exercise_logs.alternative_exercise_id.
ALTER TABLE split_exercises ADD COLUMN alternative_exercise_id TEXT REFERENCES exercises(id);

-- Snapshotted from split_exercises.alternative_exercise_id at session start. A mid-session swap
-- exchanges this with exercise_id, so exercise_id is always what was actually performed and
-- history/PRs/volume need no special case; swapping again restores the original.
ALTER TABLE exercise_logs ADD COLUMN alternative_exercise_id TEXT REFERENCES exercises(id);
```

Add `alternativeExerciseId?: string | null` to `CreateSplitExerciseInput`, write it in the
INSERT, read `ex.alternative_exercise_id` in `findWithDays`.

**Step 4:** Run, expect PASS. **Step 5:** Commit.

### Task 2: Snapshot onto exercise logs + read alt name

**Files:**
- Modify: `server/repositories/session.repository.ts` (`StartSessionExerciseInput.alternativeExerciseId?`,
  `attachExercise` INSERT, `findWithLogs` SELECT joins `exercises AS alt` for `alternative_exercise_name`, `mapExerciseLog`)
- Modify: `shared/types/session.types.ts` (`ExerciseLog.alternativeExerciseId`, `alternativeExerciseName`)
- Test: `tests/server/repositories/session.repository.test.ts`

Test: start a session with `alternativeExerciseId: 'db-bench'`; `findWithLogs` exposes both id
and name; an exercise started without one reads `null`/`null`.

### Task 3: Repository swap

**Files:** `server/repositories/session.repository.ts`, its test.

Add `findExerciseLog(id)` (same join as `findWithLogs`, one row) and:

```ts
// Exchanges exercise_id with alternative_exercise_id -- SQLite evaluates every SET right-hand
// side against the pre-update row -- only while the log has no sets and its session is running.
async swapExercise(exerciseLogId: string, toExerciseId: string, suggestion: ProgressionSuggestion | null)
  : Promise<{ status: 'swapped' | 'unchanged', exercise: ExerciseLog } | { status: 'conflict' }>
```

`UPDATE ... WHERE id = ? AND alternative_exercise_id = ? AND NOT EXISTS (sets) AND EXISTS (in_progress session) RETURNING id`.
No row → re-read: `exercise_id === toExerciseId` → `unchanged` (replay); else `conflict`.

Tests: swaps and exchanges; swapping back restores; replay is `unchanged`; with a set logged →
`conflict`; toExerciseId not the alternative → `conflict`; completed session → `conflict`;
suggestion columns rewritten (and cleared when `null`).

### Task 4: Service + route

**Files:**
- Modify: `server/services/session.service.ts` — `swapExercise(sessionId, exerciseLogId, toExerciseId)`:
  owned session, log belongs to it (404 otherwise), compute suggestion via `withSuggestions` on
  the log's prescription with `exerciseId: toExerciseId`, call repo; `conflict` → 409.
- Create: `server/api/sessions/[id]/exercises/[logId]/swap.post.ts` (openAPI meta like siblings).
- Test: `tests/server/services/session.service.test.ts`.

### Task 5: Outbox op

**Files:** `app/lib/outbox.ts`, `app/lib/outbox-store.ts` (KINDS), `app/lib/session-sync.ts`
(`describeOp` → "Swapped exercise"), `app/plugins/outbox.client.ts` (send), new
`app/composables/useSwapExercise.ts`; tests `tests/app/lib/outbox.test.ts`, `session-sync.test.ts`.

- `swap_exercise` payload `{ exerciseLogId, toExerciseId }`.
- `enqueue`: a still-pending swap of the same log is undone by the new one (a log has exactly two
  exercises, so a second swap always reverses the first) → drop both.
- `applyPending`: if the log's `alternativeExerciseId === toExerciseId`, exchange ids and names
  and null the suggestion; otherwise (already applied server-side) leave it.

### Task 6: Today's workout → session start

**Files:** `shared/types/home.types.ts`, `server/services/workouts.service.ts` (`describeDay`),
`app/pages/workouts/index.vue`, `app/pages/index.vue` start payloads. Test in
`tests/server/services/workouts.service.test.ts` that `alternativeExerciseId` is passed through.

### Task 7: Builder UI

**Files:** `app/components/builder/ExerciseSwapSheet.vue` (optional `title` prop),
`app/components/builder/DayExercisePicker.vue`, `app/pages/builder-edit/[blockId].vue`.

- Row: under the name, "+ Alternative" (or "Alt: <name> ✕"). Opens the shared swap sheet in
  `alternative` mode (title "Pick Alternative"); select sets `alternativeExerciseId`.
- Replace-mode swap onto the row's own alternative clears the alternative.
- Edit page: copy `alternativeExerciseId`, include alt ids in the catalog-cache fetch.

### Task 8: Session UI

**File:** `app/pages/workouts/session/[id].vue`.

"Swap to <alternativeExerciseName>" button (ArrowLeftRightIcon) on straight-set cards and circuit
rows when `alternativeExerciseId && sets.length === 0`. On tap, `useSwapExercise`, then clear
that log's draft and its `seededDrafts` entry so it reseeds from the new exercise's history.

### Task 9: Verify

`npx vitest run`, `npx nuxi typecheck` (or `vue-tsc`), `npm run lint:rtl`, `npx eslint` on
touched files. Manual run against a local file DB (never `.env`). Report the production schema
step (`db:seed` applies the new ALTERs) to the user rather than running it.
