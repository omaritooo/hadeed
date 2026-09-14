# Progression Suggestions & PR Rework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Suggest next session's load/reps per exercise (snapshotted at session start), and replace weight-only PR detection with weight / rep / e1RM PRs that can't be farmed for XP.

**Architecture:** Two pure functions in `shared/lib` (`progression.ts`, `personal-records.ts`) carry all the rules. `SessionService` gains `startSession`, `logSet`, `editSet`, `deleteSet`, and the four session routes delegate to it instead of calling `SessionRepository` directly. PRs move out of `xp_ledger` into a `personal_records` table.

**Tech Stack:** Nuxt 4 / Nitro, libSQL (`@libsql/client`), Vitest, Vue 3 + `@pinia/colada`.

**Design doc:** `docs/plans/2026-09-14-progression-and-prs-design.md`

---

## Before you start

- **Baseline:** run `npx vitest run` and record the counts before Task 1 (the counts in this
  plan are from when it was written; later plans have added tests since).
- **Work landed since this plan was written.** Read these fresh before editing:
  - `509f62d`: the session page (`app/pages/workouts/session/[id].vue`) now uses
    `SessionSetFields`, and `findExerciseHistory` returns every working set per session.
    The page **seeds each set's draft from the matching working set last session**
    (`previousSessionSets`, `suggestedSetValues`, the `seededDrafts` `watchEffect`, and
    `logNextSet`'s next-set suggestion), and shows a per-set "last time" hint.
  - `b397d8c`: `DayExercisePicker.vue` rows are a grid, with sets × reps as plain `Input`s on
    their own line.
  - `515e3e6`: mutation composables return `Promise.allSettled` of awaited invalidations
    from `onSuccess`, never `Promise.all`.
  - The adaptive-TDEE and joint-limitations plans have landed. `SessionService` and its
    routes are unchanged by them, but `ProfileService` now takes a `UserLimitationRepository`,
    and `Exercise` has `stressors`.
- **Typecheck:** `npx nuxi typecheck`. **Tests:** `npx vitest run <path>`.
- Commit on `main` (no worktree). Every commit message ends with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Style: arrow functions for standalone functions (`const foo = () => {}`), comment density
  like surrounding code.

---

### Task 1: Rep-range migration

**Files:**
- Create: `server/database/migrations/rep-ranges.ts`
- Create: `tests/server/database/rep-ranges-migration.test.ts`
- Modify: `server/database/schema.sql` (the three `CREATE TABLE`s that declare `target_reps`)
- Modify: `server/database/seed.ts` (`main`, migration calls)

**Step 1: Write the failing test**

```ts
// tests/server/database/rep-ranges-migration.test.ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { migrateRepRanges } from '~~/server/database/migrations/rep-ranges'

const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const

const createOldSchemaDb = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hadeed-rep-ranges-test-'))
  const db = createClient({ url: `file:${join(dir, 'test.db')}` })
  for (const table of TABLES) {
    await db.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, target_sets INTEGER, target_reps INTEGER, target_rpe REAL)`)
    await db.execute(`INSERT INTO ${table} (id, target_sets, target_reps, target_rpe) VALUES (1, 3, 8, 7), (2, 2, NULL, NULL)`)
  }
  return db
}

const columnsOf = async (db: ReturnType<typeof createClient>, table: string) =>
  (await db.execute(`PRAGMA table_info(${table})`)).rows.map(row => row.name as string)

describe('migrateRepRanges', () => {
  it('copies target_reps into min and max, then drops target_reps', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)

    for (const table of TABLES) {
      const columns = await columnsOf(db, table)
      expect(columns).toContain('target_reps_min')
      expect(columns).toContain('target_reps_max')
      expect(columns).not.toContain('target_reps')

      const rows = (await db.execute(`SELECT id, target_reps_min, target_reps_max FROM ${table} ORDER BY id`)).rows
      expect(rows[0]).toMatchObject({ target_reps_min: 8, target_reps_max: 8 })
      expect(rows[1]).toMatchObject({ target_reps_min: null, target_reps_max: null })
    }
  })

  it('is a no-op on an already-migrated database', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)
    await expect(migrateRepRanges(db)).resolves.toBeUndefined()
    expect(await columnsOf(db, 'exercise_logs')).not.toContain('target_reps')
  })
})
```

**Step 2: Run it to verify it fails**

Run: `npx vitest run tests/server/database/rep-ranges-migration.test.ts`
Expected: FAIL, cannot resolve `~~/server/database/migrations/rep-ranges`.

**Step 3: Implement**

```ts
// server/database/migrations/rep-ranges.ts
import type { Client } from '@libsql/client'

const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const

// Replaces the single target_reps prescription with a min/max rep range so double progression
// has a "top of the range" to aim for. No table rebuild is needed: SQLite supports ADD COLUMN
// and DROP COLUMN for a column that isn't indexed or constrained. Existing rows keep their
// meaning by becoming a zero-width range (min = max = old target). Run through db.migrate()
// so each table's add/copy/drop lands atomically -- see equipment-tiers.ts for why separate
// execute() calls aren't reliable over the HTTP transport.
export const migrateRepRanges = async (db: Client): Promise<void> => {
  for (const table of TABLES) {
    const info = await db.execute(`PRAGMA table_info(${table})`)
    const columns = info.rows.map(row => row.name as string)
    if (!columns.includes('target_reps')) continue

    console.log(`Migrating ${table}.target_reps to a min/max range...`)
    await db.migrate([
      `ALTER TABLE ${table} ADD COLUMN target_reps_min INTEGER`,
      `ALTER TABLE ${table} ADD COLUMN target_reps_max INTEGER`,
      `UPDATE ${table} SET target_reps_min = target_reps, target_reps_max = target_reps`,
      `ALTER TABLE ${table} DROP COLUMN target_reps`,
    ])
  }
}
```

**Step 4: Run it to verify it passes**

Run: `npx vitest run tests/server/database/rep-ranges-migration.test.ts`
Expected: PASS (2 tests).

**Step 5: Update the schema for fresh databases**

In `server/database/schema.sql`, in each of `split_exercises`, `preset_split_exercises` and
`exercise_logs`, replace the line

```sql
  target_reps   INTEGER,
```

(alignment varies per table) with

```sql
  target_reps_min INTEGER,
  target_reps_max INTEGER,
```

In `server/database/seed.ts`, import `migrateRepRanges` next to the other migrations and call
`await migrateRepRanges(db)` after `await migrateUserProfilesGoalTiers(db)` in `main`.

**Step 6: Commit**

```bash
git add server/database/migrations/rep-ranges.ts tests/server/database/rep-ranges-migration.test.ts server/database/schema.sql server/database/seed.ts
git commit -m "feat(db): replace target_reps with a min/max rep range"
```

(Many tests fail after this commit until Task 2. That's expected; don't push between them.)

---

### Task 2: Rename `targetReps` → `targetRepsMin` / `targetRepsMax` everywhere

A mechanical rename. No behavior change beyond carrying two numbers.

**Files (every current `targetReps` / `target_reps` site):**
- Types: `shared/types/split.types.ts` (`SplitExercise`), `shared/types/preset.types.ts` (`PresetSplitExercise`), `shared/types/home.types.ts` (`TodaysWorkoutExercise`), `shared/types/session.types.ts` (`ExerciseLog`)
- Repos: `server/repositories/block.repository.ts` (`CreateSplitExerciseInput`, `createWithDays` insert, `findWithDays` mapping), `server/repositories/preset-split.repository.ts` (input type, insert, mapping), `server/repositories/session.repository.ts` (`StartSessionExerciseInput`, `mapExerciseLog`, both `INSERT INTO exercise_logs`)
- Services: `server/services/split.service.ts` (`createFromPreset`), `server/services/workouts.service.ts` (`buildTodaysWorkout`)
- Route: `server/api/sessions/index.post.ts` (OpenAPI `targetReps` → `targetRepsMin` + `targetRepsMax`)
- Seeds: `server/database/seed.ts`, `server/database/seed-dummy.ts`
- Client: `app/pages/index.vue` and `app/pages/workouts/index.vue` (`startTodaysWorkout` payload), `app/pages/builder-edit/[blockId].vue`, `app/components/builder/DayExercisePicker.vue`, `app/pages/workouts/session/[id].vue` (`formatTarget`), `app/pages/workouts/index.vue` (`{{ exercise.targetSets }}×{{ exercise.targetReps }}`)
- Tests: every file listed by `grep -rln "targetReps\|target_reps" tests`

**Step 1: Rename types and repository SQL**

- Each type: `targetReps: number | null` → `targetRepsMin: number | null` and `targetRepsMax: number | null`.
- Each insert: column list `target_reps` → `target_reps_min, target_reps_max`, add one `?`, and pass `exercise.targetRepsMin, exercise.targetRepsMax`.
- Each mapping: `targetReps: row.target_reps as number | null` → `targetRepsMin: row.target_reps_min as number | null, targetRepsMax: row.target_reps_max as number | null`.
- `addFreeformExercise`'s insert gets `NULL, NULL` for the two columns.

**Step 2: Seed preset ranges**

Add near the top of `server/database/seed.ts`:

```ts
// Preset prescriptions are authored as a single rep target and widened into a range here, so
// double progression has room to work: low-rep strength work gets a 2-rep window, moderate
// hypertrophy work 2, higher-rep isolation work 3, and conditioning-style high reps 5.
const reps = (target: number | null): { targetRepsMin: number | null, targetRepsMax: number | null } => {
  if (target === null) return { targetRepsMin: null, targetRepsMax: null }
  if (target <= 10) return { targetRepsMin: target, targetRepsMax: target + 2 }
  if (target <= 15) return { targetRepsMin: target, targetRepsMax: target + 3 }
  return { targetRepsMin: target, targetRepsMax: target + 5 }
}
```

Then rewrite every literal in one pass and review the diff:

```bash
perl -pi -e 's/targetReps: (\d+|null)/...reps($1)/g' server/database/seed.ts
git diff --stat server/database/seed.ts
```

Expected: ~200 lines changed, all of the form `...reps(8)`.

In `seed-dummy.ts`, give `SplitExerciseSpec` `targetRepsMin`/`targetRepsMax`, make `wr`/`bw`
set both to the passed number, update its `exercise_logs` insert the same way as Step 1,
and base the generated reps on `splitExercise.targetRepsMin ?? 8`.

**Step 3: Client**

- Start payloads (`index.vue`, `workouts/index.vue`): replace `targetReps: exercise.targetReps,` with `targetRepsMin: exercise.targetRepsMin,` and `targetRepsMax: exercise.targetRepsMax,`.
- `builder-edit/[blockId].vue`: same mapping.
- `workouts/index.vue` label: `{{ exercise.targetSets }}×{{ formatRepRange(exercise.targetRepsMin, exercise.targetRepsMax) }}`.
- Add `app/utils/format-rep-range.ts` (Nuxt auto-imports `app/utils`):

```ts
export const formatRepRange = (min: number | null, max: number | null): string => {
  if (min === null && max === null) return '–'
  if (min === null || max === null || min === max) return String(min ?? max)
  return `${min}–${max}`
}
```

- Session page `formatTarget(targetSets, targetRepsMin, targetRepsMax, targetRpe)`: build `setsReps` as `` `${targetSets ?? '–'}×${formatRepRange(targetRepsMin, targetRepsMax)}` ``.
- `DayExercisePicker.vue`: the new-exercise default becomes `targetRepsMin: 8, targetRepsMax: 10`. The single reps input is replaced in Task 12. For now, bind it to `targetRepsMin` and write both fields on update so it compiles.

**Step 4: Tests**

Update fixtures in each test file from `grep -rln "targetReps\|target_reps" tests`. SQL
fixtures `target_reps` → `target_reps_min, target_reps_max` with the value duplicated.
Object fixtures `targetReps: 8` → `targetRepsMin: 8, targetRepsMax: 8`.

**Step 5: Verify**

Run: `grep -rn "targetReps\b\|target_reps\b" app server shared tests`
Expected: no output. (`\b` so `target_reps_min` doesn't match.)

Run: `npx vitest run`
Expected: all pass (369 = 367 + Task 1's 2).

Run: `npx nuxi typecheck`
Expected: no new errors versus a pre-change run.

**Step 6: Commit**

```bash
git add -A server shared app tests
git commit -m "refactor: carry prescriptions as a min/max rep range end to end"
```

(Before committing, `git status` must show only files from this task. Another session's
dirty files must not be swept in. Stage paths explicitly if in doubt.)

---

### Task 3: `suggestProgression` pure function

**Files:**
- Create: `shared/lib/progression.ts`
- Create: `tests/shared/lib/progression.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/shared/lib/progression.test.ts
import { describe, expect, it } from 'vitest'
import { lbsToKg } from '~~/shared/lib/formulas'
import { suggestProgression, workingWeight, type ProgressionInput, type WorkingSet } from '~~/shared/lib/progression'

const set = (weightKg: number | null, reps: number | null, rpe: number | null = null): WorkingSet => ({ weightKg, reps, rpe })

const bench = (overrides: Partial<ProgressionInput> = {}): ProgressionInput => ({
  prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: null },
  recentSessions: [],
  setType: 'weight_reps',
  equipment: 'barbell',
  movementPattern: 'horizontal_push',
  unitSystem: 'metric',
  ...overrides,
})

describe('workingWeight', () => {
  it('ignores a single heavy top set', () => {
    expect(workingWeight([set(100, 3), set(80, 10), set(80, 10), set(80, 10)])).toBe(80)
  })

  it('returns null when no weights were logged', () => {
    expect(workingWeight([set(null, 10)])).toBeNull()
  })
})

describe('suggestProgression', () => {
  it('returns null for time-based exercises', () => {
    expect(suggestProgression(bench({ setType: 'time', recentSessions: [[set(null, null)]] }))).toBeNull()
  })

  it('returns null when the prescription has no rep range', () => {
    expect(suggestProgression(bench({ prescription: { sets: 3, repsMin: null, repsMax: null, rpe: null } }))).toBeNull()
  })

  it('marks an exercise with no history as first_time, with no weight', () => {
    expect(suggestProgression(bench())).toEqual({ action: 'first_time', reason: 'first_time', weightKg: null, repsMin: 8, repsMax: 10 })
  })

  it('adds 2.5kg to an upper-body barbell lift once every set hits the top of the range', () => {
    const result = suggestProgression(bench({ recentSessions: [[set(60, 10), set(60, 10), set(60, 10)]] }))
    expect(result).toEqual({ action: 'increase', reason: 'all_sets_top_of_range', weightKg: 62.5, repsMin: 8, repsMax: 10 })
  })

  it('adds 5kg to a lower-body barbell lift', () => {
    const result = suggestProgression(bench({ movementPattern: 'knee_dominant', recentSessions: [[set(100, 10), set(100, 10), set(100, 10)]] }))
    expect(result?.weightKg).toBe(105)
  })

  it('adds 2kg to a dumbbell lift', () => {
    const result = suggestProgression(bench({ equipment: 'dumbbell', recentSessions: [[set(20, 10), set(20, 10), set(20, 10)]] }))
    expect(result?.weightKg).toBe(22)
  })

  it('rounds in pounds for imperial users and stores kg', () => {
    // 100kg = 220.46lb → snaps to 220lb, +5lb = 225lb
    const result = suggestProgression(bench({ unitSystem: 'imperial', recentSessions: [[set(100, 10), set(100, 10), set(100, 10)]] }))
    expect(result?.weightKg).toBeCloseTo(lbsToKg(225), 6)
  })

  it('holds and builds reps when not every set reached the top', () => {
    const result = suggestProgression(bench({ recentSessions: [[set(60, 10), set(60, 9), set(60, 8)]] }))
    expect(result).toEqual({ action: 'hold', reason: 'building_reps', weightKg: 60, repsMin: 8, repsMax: 10 })
  })

  it('holds when fewer sets than prescribed were logged, even at the top of the range', () => {
    const result = suggestProgression(bench({ recentSessions: [[set(60, 10), set(60, 10)]] }))
    expect(result?.action).toBe('hold')
  })

  it('uses the logged set count when the prescription has no set count', () => {
    const result = suggestProgression(bench({
      prescription: { sets: null, repsMin: 8, repsMax: 10, rpe: null },
      recentSessions: [[set(60, 10), set(60, 10)]],
    }))
    expect(result?.action).toBe('increase')
  })

  it('holds when average RPE is well above target, even with every set at the top', () => {
    const result = suggestProgression(bench({
      prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: 7 },
      recentSessions: [[set(60, 10, 9), set(60, 10, 9), set(60, 10, 8.5)]],
    }))
    expect(result).toMatchObject({ action: 'hold', reason: 'rpe_too_high', weightKg: 60 })
  })

  it('still increases when RPE is only slightly above target', () => {
    const result = suggestProgression(bench({
      prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: 7 },
      recentSessions: [[set(60, 10, 7.5), set(60, 10, 7.5), set(60, 10, 7.5)]],
    }))
    expect(result?.action).toBe('increase')
  })

  it('increases when RPE is far below target and every set reached the bottom of the range', () => {
    const result = suggestProgression(bench({
      prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: 8 },
      recentSessions: [[set(60, 8, 5), set(60, 8, 6), set(60, 8, 6)]],
    }))
    expect(result).toMatchObject({ action: 'increase', reason: 'rpe_too_low', weightKg: 62.5 })
  })

  it('reduces by ~10% after missing the bottom of the range two sessions running', () => {
    const result = suggestProgression(bench({
      recentSessions: [
        [set(100, 8), set(100, 7), set(100, 6)],
        [set(100, 8), set(100, 6), set(100, 6)],
      ],
    }))
    expect(result).toEqual({ action: 'reduce', reason: 'missed_min_twice', weightKg: 90, repsMin: 8, repsMax: 10 })
  })

  it('does not reduce after a single session below the range', () => {
    const result = suggestProgression(bench({
      recentSessions: [
        [set(100, 8), set(100, 7), set(100, 6)],
        [set(100, 10), set(100, 9), set(100, 8)],
      ],
    }))
    expect(result?.action).toBe('hold')
  })

  it('checks missed-min-twice before RPE', () => {
    const result = suggestProgression(bench({
      prescription: { sets: 3, repsMin: 8, repsMax: 10, rpe: 7 },
      recentSessions: [
        [set(100, 6, 10), set(100, 6, 10), set(100, 6, 10)],
        [set(100, 7, 10), set(100, 6, 10), set(100, 6, 10)],
      ],
    }))
    expect(result?.action).toBe('reduce')
  })

  it('progresses bodyweight exercises by reps, never weight', () => {
    const result = suggestProgression(bench({
      setType: 'bodyweight_reps',
      equipment: 'body only',
      recentSessions: [[set(null, 10), set(null, 10), set(null, 10)]],
    }))
    expect(result).toEqual({ action: 'increase', reason: 'all_sets_top_of_range', weightKg: null, repsMin: 11, repsMax: 12 })
  })

  it('holds rather than reducing a bodyweight exercise', () => {
    const result = suggestProgression(bench({
      setType: 'bodyweight_reps',
      recentSessions: [[set(null, 5)], [set(null, 5)]],
    }))
    expect(result).toMatchObject({ action: 'hold', reason: 'missed_min_twice', weightKg: null })
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/shared/lib/progression.test.ts`
Expected: FAIL, cannot resolve `~~/shared/lib/progression`.

**Step 3: Implement**

```ts
// shared/lib/progression.ts
import { kgToLbs, lbsToKg } from '~~/shared/lib/formulas'
import type { SetType } from '~~/shared/types/split.types'

export type SuggestionAction = 'increase' | 'hold' | 'reduce' | 'first_time'
export type SuggestionReason =
  | 'first_time'
  | 'missed_min_twice'
  | 'rpe_too_high'
  | 'all_sets_top_of_range'
  | 'rpe_too_low'
  | 'building_reps'
export type UnitSystem = 'metric' | 'imperial'

export interface WorkingSet {
  weightKg: number | null
  reps: number | null
  rpe: number | null
}

export interface ProgressionInput {
  prescription: { sets: number | null, repsMin: number | null, repsMax: number | null, rpe: number | null }
  // Working (non-warm-up) sets of the most recent completed sessions containing this exercise,
  // newest session first.
  recentSessions: WorkingSet[][]
  setType: SetType
  equipment: string | null
  movementPattern: string | null
  unitSystem: UnitSystem
}

export interface ProgressionSuggestion {
  action: SuggestionAction
  reason: SuggestionReason
  weightKg: number | null
  repsMin: number
  repsMax: number
}

const LOWER_BODY_PATTERNS = new Set(['knee_dominant', 'hip_dominant'])
const RPE_TOO_HIGH_MARGIN = 1.5
const RPE_INCREASE_TOLERANCE = 0.5
const RPE_TOO_LOW_MARGIN = 2
const REDUCE_FACTOR = 0.9

// The smallest sensible jump, in the user's own unit.
export const loadIncrement = (equipment: string | null, movementPattern: string | null, unitSystem: UnitSystem): number => {
  const metric = unitSystem === 'metric'
  if (equipment === 'barbell' && movementPattern !== null && LOWER_BODY_PATTERNS.has(movementPattern)) return metric ? 5 : 10
  if (equipment === 'dumbbell') return metric ? 2 : 5
  return metric ? 2.5 : 5
}

const toUnit = (kg: number, unitSystem: UnitSystem) => (unitSystem === 'metric' ? kg : kgToLbs(kg))
const fromUnit = (value: number, unitSystem: UnitSystem) => (unitSystem === 'metric' ? value : lbsToKg(value))
const snap = (value: number, increment: number) => Math.round(value / increment) * increment

// The weight at or above which at least half the working sets were done (an upper median), so
// one heavy top single or a ramp-up set doesn't define it.
export const workingWeight = (sets: WorkingSet[]): number | null => {
  const weights = sets
    .map(s => s.weightKg)
    .filter((w): w is number => w !== null)
    .sort((a, b) => b - a)
  if (weights.length === 0) return null
  return weights[Math.ceil(weights.length / 2) - 1]!
}

const averageRpe = (sets: WorkingSet[]): number | null => {
  const rpes = sets.map(s => s.rpe).filter((r): r is number => r !== null)
  if (rpes.length === 0) return null
  return rpes.reduce((sum, r) => sum + r, 0) / rpes.length
}

const countReaching = (sets: WorkingSet[], reps: number) => sets.filter(s => s.reps !== null && s.reps >= reps).length
const missedMin = (sets: WorkingSet[] | undefined, repsMin: number) =>
  sets !== undefined && sets.some(s => s.reps !== null && s.reps < repsMin)

/**
 * Double progression with RPE autoregulation. Rules are checked in order and the first match
 * wins -- see docs/plans/2026-09-14-progression-and-prs-design.md for the reasoning behind
 * each threshold. Returns null when there's nothing to progress (time-based work, or a
 * prescription with no rep range).
 */
export const suggestProgression = (input: ProgressionInput): ProgressionSuggestion | null => {
  const { prescription, recentSessions, setType, unitSystem } = input
  const { repsMin, repsMax } = prescription
  if (setType === 'time' || repsMin === null || repsMax === null) return null

  const last = recentSessions[0] ?? []
  if (last.length === 0) return { action: 'first_time', reason: 'first_time', weightKg: null, repsMin, repsMax }

  const current = setType === 'weight_reps' ? workingWeight(last) : null
  const increment = loadIncrement(input.equipment, input.movementPattern, unitSystem)

  const hold = (reason: SuggestionReason): ProgressionSuggestion =>
    ({ action: 'hold', reason, weightKg: current, repsMin, repsMax })

  const increase = (reason: SuggestionReason): ProgressionSuggestion => {
    if (current === null) return { action: 'increase', reason, weightKg: null, repsMin: repsMax + 1, repsMax: repsMax + 2 }
    const next = snap(toUnit(current, unitSystem), increment) + increment
    return { action: 'increase', reason, weightKg: fromUnit(next, unitSystem), repsMin, repsMax }
  }

  // 1. Missed the bottom of the range two sessions running -> back off (loadable work only).
  if (missedMin(recentSessions[0], repsMin) && missedMin(recentSessions[1], repsMin)) {
    if (current === null) return hold('missed_min_twice')
    const reduced = snap(toUnit(current, unitSystem) * REDUCE_FACTOR, increment)
    return { action: 'reduce', reason: 'missed_min_twice', weightKg: fromUnit(reduced, unitSystem), repsMin, repsMax }
  }

  const avgRpe = averageRpe(last)
  const targetRpe = prescription.rpe
  const rpeKnown = avgRpe !== null && targetRpe !== null

  // 2. Grinding well above the prescribed effort -> don't add load.
  if (rpeKnown && avgRpe >= targetRpe + RPE_TOO_HIGH_MARGIN) return hold('rpe_too_high')

  const setsRequired = prescription.sets ?? last.length

  // 3. Every prescribed set reached the top of the range at a sane effort.
  if (countReaching(last, repsMax) >= setsRequired && (!rpeKnown || avgRpe <= targetRpe + RPE_INCREASE_TOLERANCE)) {
    return increase('all_sets_top_of_range')
  }

  // 4. Far easier than prescribed, and at least in the range on every set.
  if (rpeKnown && avgRpe <= targetRpe - RPE_TOO_LOW_MARGIN && countReaching(last, repsMin) >= setsRequired) {
    return increase('rpe_too_low')
  }

  return hold('building_reps')
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/shared/lib/progression.test.ts`
Expected: PASS (19 tests).

**Step 5: Commit**

```bash
git add shared/lib/progression.ts tests/shared/lib/progression.test.ts
git commit -m "feat(progression): add double-progression suggestion rules with RPE autoregulation"
```

---

### Task 4: `findRecentWorkingSets` repository query

**Files:**
- Modify: `server/repositories/session.repository.ts` (new method after `findLastPerformedForExercises`)
- Modify: `tests/server/repositories/session.repository.test.ts` (new `describe`)

**Step 1: Write the failing test**

Append to the test file (it already has `seedUserAndBlock`):

```ts
describe('SessionRepository.findRecentWorkingSets', () => {
  let db: Client
  let repo: SessionRepository

  const completedSession = async (id: string, startedAt: string, sets: { weightKg: number, reps: number, rpe: number | null, isWarmup?: boolean }[]) => {
    await repo.startSession('user-1', { id, splitDayId: null, exercises: [] })
    await db.execute({ sql: 'UPDATE workout_sessions SET started_at = ? WHERE id = ?', args: [startedAt, id] })
    await repo.addFreeformExercise({ id: `${id}-ex`, sessionId: id, exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    for (const [i, s] of sets.entries()) {
      await repo.logSet({ id: `${id}-set-${i}`, exerciseLogId: `${id}-ex`, setNumber: i + 1, ...s })
    }
    await repo.completeSession(id, 1)
  }

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('returns working sets of the most recent completed sessions, newest first, in set order', async () => {
    await completedSession('s-old', '2026-01-01 10:00:00', [{ weightKg: 50, reps: 8, rpe: null }])
    await completedSession('s-mid', '2026-01-03 10:00:00', [{ weightKg: 55, reps: 8, rpe: 7 }, { weightKg: 55, reps: 7, rpe: 8 }])
    await completedSession('s-new', '2026-01-05 10:00:00', [{ weightKg: 20, reps: 10, rpe: null, isWarmup: true }, { weightKg: 60, reps: 8, rpe: 7 }])

    const result = await repo.findRecentWorkingSets('user-1', 'bench-press', 2)

    expect(result).toEqual([
      [{ weightKg: 60, reps: 8, rpe: 7 }],
      [{ weightKg: 55, reps: 8, rpe: 7 }, { weightKg: 55, reps: 7, rpe: 8 }],
    ])
  })

  it('ignores in-progress sessions', async () => {
    await repo.startSession('user-1', { id: 's-live', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 's-live-ex', sessionId: 's-live', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await repo.logSet({ id: 's-live-set', exerciseLogId: 's-live-ex', setNumber: 1, weightKg: 70, reps: 5, rpe: null })

    expect(await repo.findRecentWorkingSets('user-1', 'bench-press', 2)).toEqual([])
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts -t findRecentWorkingSets`
Expected: FAIL, `repo.findRecentWorkingSets is not a function`.

**Step 3: Implement**

```ts
  // Progression input: every working set (warm-ups excluded, RPE included) from the `sessions`
  // most recent *completed* sessions containing this exercise, grouped per session, newest
  // first. Separate from findExerciseHistory because progression needs RPE and must ignore the
  // in-progress session being started.
  async findRecentWorkingSets(userId: string, exerciseId: string, sessions: number): Promise<WorkingSet[][]> {
    const result = await this.db.execute({
      sql: `WITH recent AS (
              SELECT DISTINCT ws.id, COALESCE(ws.completed_at, ws.started_at) AS session_date, ws.rowid AS session_rowid
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
      const sessionId = row.session_id as string
      const sets = bySession.get(sessionId) ?? []
      sets.push({ weightKg: row.weight_kg as number | null, reps: row.reps as number | null, rpe: row.rpe as number | null })
      bySession.set(sessionId, sets)
    }
    return [...bySession.values()]
  }
```

Add `import type { WorkingSet } from '~~/shared/lib/progression'` at the top.

Note: `completeSession` sets `completed_at = datetime('now')`, so in the test all three
sessions complete at nearly the same second. If ordering flakes, add
`UPDATE workout_sessions SET completed_at = started_at WHERE id = ?` inside `completedSession`
after completing.

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat(sessions): query recent working sets per exercise for progression"
```

---

### Task 5: Snapshot suggestion columns on `exercise_logs`

**Files:**
- Modify: `server/database/schema.sql` (after `ALTER TABLE exercise_logs ADD COLUMN rest_seconds INTEGER;`)
- Modify: `shared/types/session.types.ts` (`ExerciseLog`)
- Modify: `server/repositories/session.repository.ts` (`StartSessionExerciseInput`, `attachExercise`, `mapExerciseLog`)
- Test: `tests/server/repositories/session.repository.test.ts`

**Step 1: Write the failing test** (in the `startSession` describe)

```ts
  it('snapshots a progression suggestion onto the exercise log', async () => {
    await repo.startSession('user-1', {
      id: 'session-s',
      splitDayId: 1,
      exercises: [{
        id: 'exlog-s', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps',
        targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRpe: 7,
        suggestion: { action: 'increase', reason: 'all_sets_top_of_range', weightKg: 62.5, repsMin: 8, repsMax: 10 },
      }],
    })

    const [exercise] = (await repo.findWithLogs('session-s'))!.exercises
    expect(exercise!.suggestion).toEqual({ action: 'increase', reason: 'all_sets_top_of_range', weightKg: 62.5, repsMin: 8, repsMax: 10 })
  })

  it('reports a null suggestion when none was snapshotted', async () => {
    await repo.startSession('user-1', {
      id: 'session-n', splitDayId: null,
      exercises: [{ id: 'exlog-n', exerciseId: 'bench-press', splitExerciseId: null, position: 0, setType: 'weight_reps', targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRpe: null }],
    })
    expect((await repo.findWithLogs('session-n'))!.exercises[0]!.suggestion).toBeNull()
  })
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts -t suggestion`
Expected: FAIL (typecheck-free Vitest runs it; `suggestion` is `undefined`).

**Step 3: Implement**

`schema.sql`:

```sql
-- Progression suggestion snapshotted at session start (see shared/lib/progression.ts), for the
-- same reason as rest_seconds: a past session keeps saying what it suggested even after later
-- set edits. suggestion_reason is a reason key, not prose, so it can be translated.
ALTER TABLE exercise_logs ADD COLUMN suggested_weight_kg REAL;
ALTER TABLE exercise_logs ADD COLUMN suggested_reps_min INTEGER;
ALTER TABLE exercise_logs ADD COLUMN suggested_reps_max INTEGER;
ALTER TABLE exercise_logs ADD COLUMN suggestion_action TEXT CHECK (suggestion_action IN ('increase','hold','reduce','first_time'));
ALTER TABLE exercise_logs ADD COLUMN suggestion_reason TEXT;
```

`session.types.ts`: add `suggestion: ProgressionSuggestion | null` to `ExerciseLog`, with
`import type { ProgressionSuggestion } from '~~/shared/lib/progression'`.

`session.repository.ts`:
- `StartSessionExerciseInput` gains `suggestion?: ProgressionSuggestion | null`.
- `attachExercise` insert: add the five columns and args
  `s?.weightKg ?? null, s?.repsMin ?? null, s?.repsMax ?? null, s?.action ?? null, s?.reason ?? null`
  where `const s = exercise.suggestion`.
- `mapExerciseLog`:

```ts
      suggestion: row.suggestion_action
        ? {
            action: row.suggestion_action as SuggestionAction,
            reason: row.suggestion_reason as SuggestionReason,
            weightKg: row.suggested_weight_kg as number | null,
            repsMin: row.suggested_reps_min as number,
            repsMax: row.suggested_reps_max as number,
          }
        : null,
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/database/schema.sql shared/types/session.types.ts server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat(sessions): snapshot a progression suggestion on each exercise log"
```

---

### Task 6: `SessionService.startSession` computes suggestions

**Files:**
- Modify: `server/services/session.service.ts`
- Modify: `server/api/sessions/index.post.ts`
- Test: `tests/server/services/session.service.test.ts`

The service needs `ExerciseRepository` (equipment, movement pattern) and `ProfileRepository`
(unit system). Pass them as a trailing options object so existing constructor call sites
don't have to change in this task:

```ts
constructor(
  ctx, sessions, blocks, gamification, xp, streaks,
  private deps: { exercises?: ExerciseRepository, profiles?: ProfileRepository, personalRecords?: PersonalRecordRepository } = {},
)
```

(`personalRecords` is used from Task 9.)

**Step 1: Write the failing tests** (new `describe` in `session.service.test.ts`)

```ts
describe('SessionService.startSession', () => {
  let db: Client
  let sessions: SessionRepository
  let service: SessionService

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, equipment, movement_pattern, instructions) VALUES ('bench-press', 'Bench Press', 'barbell', 'horizontal_push', '[]')`)
    service = new SessionService(ctx(), sessions, new BlockRepository(db), {} as never, new XpRepository(db), new StreakRepository(db), {
      exercises: new ExerciseRepository(db),
      profiles: new ProfileRepository(db),
    })
  })

  const exercise = (id: string) => ({
    id, exerciseId: 'bench-press', splitExerciseId: null, position: 0, setType: 'weight_reps' as const,
    targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRpe: null,
  })

  it('snapshots first_time for an exercise with no history', async () => {
    await service.startSession({ id: 's1', splitDayId: null, exercises: [exercise('e1')] })
    expect((await sessions.findWithLogs('s1'))!.exercises[0]!.suggestion?.action).toBe('first_time')
  })

  it('snapshots an increase after a session at the top of the range', async () => {
    await service.startSession({ id: 's1', splitDayId: null, exercises: [exercise('e1')] })
    for (const n of [1, 2, 3]) await sessions.logSet({ id: `set-${n}`, exerciseLogId: 'e1', setNumber: n, weightKg: 60, reps: 10, rpe: null })
    await sessions.completeSession('s1', 1)

    await service.startSession({ id: 's2', splitDayId: null, exercises: [exercise('e2')] })

    expect((await sessions.findWithLogs('s2'))!.exercises[0]!.suggestion).toMatchObject({ action: 'increase', weightKg: 62.5 })
  })

  it('still starts the session when loading history throws', async () => {
    vi.spyOn(sessions, 'findRecentWorkingSets').mockRejectedValueOnce(new Error('db down'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await service.startSession({ id: 's1', splitDayId: null, exercises: [exercise('e1')] })

    expect((await sessions.findWithLogs('s1'))!.exercises[0]!.suggestion).toBeNull()
    consoleErrorSpy.mockRestore()
  })
})
```

Add imports for `ExerciseRepository` and `ProfileRepository`.

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/services/session.service.test.ts -t startSession`
Expected: FAIL, `service.startSession is not a function`.

**Step 3: Implement** (in `SessionService`)

```ts
  async startSession(input: StartSessionInput): Promise<WorkoutSession> {
    await this.sessions.expireStaleSessions(this.ctx.userId)
    const exercises = await this.withSuggestions(input.exercises)
    return this.sessions.startSession(this.ctx.userId, { ...input, exercises })
  }

  // Never blocks starting a workout: if anything about computing suggestions fails, the
  // exercises are attached with no suggestion and the UI simply doesn't show one.
  private async withSuggestions(exercises: StartSessionExerciseInput[]): Promise<StartSessionExerciseInput[]> {
    const { exercises: exerciseRepo, profiles } = this.deps
    if (!exerciseRepo || !profiles || exercises.length === 0) return exercises

    try {
      const [catalog, profile] = await Promise.all([
        exerciseRepo.findByIds([...new Set(exercises.map(e => e.exerciseId))]),
        profiles.findByUserId(this.ctx.userId),
      ])
      const byId = new Map(catalog.map(e => [e.id, e]))
      const unitSystem = profile?.unitSystem ?? 'metric'

      return await Promise.all(exercises.map(async (exercise) => {
        const recentSessions = await this.sessions.findRecentWorkingSets(this.ctx.userId, exercise.exerciseId, 2)
        const meta = byId.get(exercise.exerciseId)
        const suggestion = suggestProgression({
          prescription: { sets: exercise.targetSets, repsMin: exercise.targetRepsMin, repsMax: exercise.targetRepsMax, rpe: exercise.targetRpe },
          recentSessions,
          setType: exercise.setType,
          equipment: meta?.equipment ?? null,
          movementPattern: meta?.movementPattern ?? null,
          unitSystem,
        })
        return { ...exercise, suggestion }
      }))
    } catch (error) {
      console.error('SessionService.withSuggestions failed; starting session without suggestions', { error })
      return exercises
    }
  }
```

Route `server/api/sessions/index.post.ts` handler body becomes:

```ts
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const db = useDb()
  const sessions = new SessionRepository(db)
  const xp = new XpRepository(db)
  const streaks = new StreakRepository(db)
  const gamification = new GamificationService(xp, streaks, new AchievementRepository(db), sessions)
  const service = new SessionService(ctx, sessions, new BlockRepository(db), gamification, xp, streaks, {
    exercises: new ExerciseRepository(db),
    profiles: new ProfileRepository(db),
  })
  return service.startSession(body)
```

Also update the OpenAPI description: "…then starts a new one, snapshotting a progression suggestion per exercise."

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/services/session.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/services/session.service.ts server/api/sessions/index.post.ts tests/server/services/session.service.test.ts
git commit -m "feat(sessions): compute progression suggestions when a session starts"
```

---

### Task 7: `detectPersonalRecords` pure function

**Files:**
- Create: `shared/lib/personal-records.ts`
- Create: `tests/shared/lib/personal-records.test.ts`
- Delete (Task 9): `server/utils/pr.ts`, `tests/server/utils/pr.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/shared/lib/personal-records.test.ts
import { describe, expect, it } from 'vitest'
import { detectPersonalRecords, estimateOneRepMax } from '~~/shared/lib/personal-records'

const working = (weightKg: number, reps: number) => ({ weightKg, reps, isWarmup: false })

describe('estimateOneRepMax', () => {
  it('uses Epley', () => {
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.667, 3)
  })
})

describe('detectPersonalRecords', () => {
  it('never counts a first-ever set as a PR', () => {
    expect(detectPersonalRecords(working(100, 5), [])).toEqual([])
  })

  it('never counts a warm-up', () => {
    expect(detectPersonalRecords({ weightKg: 200, reps: 5, isWarmup: true }, [{ weightKg: 100, reps: 5 }])).toEqual([])
  })

  it('detects a weight PR (and the e1RM PR it implies)', () => {
    const prs = detectPersonalRecords(working(105, 5), [{ weightKg: 100, reps: 5 }])
    expect(prs.map(p => p.type).sort()).toEqual(['e1rm', 'weight'])
    expect(prs.find(p => p.type === 'weight')).toEqual({ type: 'weight', value: 105, previousValue: 100 })
  })

  it('detects a rep PR at the same weight', () => {
    const prs = detectPersonalRecords(working(100, 7), [{ weightKg: 100, reps: 5 }, { weightKg: 90, reps: 10 }])
    expect(prs.find(p => p.type === 'reps')).toEqual({ type: 'reps', value: 7, previousValue: 5 })
    expect(prs.find(p => p.type === 'weight')).toBeUndefined()
  })

  it('compares reps against sets at this weight or heavier only', () => {
    // 12 reps at 90 was done before, but never at >= 100kg -> 6 reps at 100 beats the 100kg best of 5
    const prs = detectPersonalRecords(working(100, 6), [{ weightKg: 100, reps: 5 }, { weightKg: 90, reps: 12 }])
    expect(prs.find(p => p.type === 'reps')?.previousValue).toBe(5)
  })

  it('treats a heavier prior set with more reps as blocking a rep PR', () => {
    expect(detectPersonalRecords(working(100, 6), [{ weightKg: 110, reps: 8 }]).find(p => p.type === 'reps')).toBeUndefined()
  })

  it('detects an e1RM PR without a weight or rep PR', () => {
    // prior: 100x5 (e1RM 116.7) and 90x12; new 95x8 (e1RM 120.3)
    const prs = detectPersonalRecords(working(95, 8), [{ weightKg: 100, reps: 5 }, { weightKg: 90, reps: 12 }])
    expect(prs.map(p => p.type)).toEqual(['e1rm'])
  })

  it('ignores sets above 12 reps for e1RM, on either side', () => {
    expect(detectPersonalRecords(working(60, 20), [{ weightKg: 100, reps: 3 }]).find(p => p.type === 'e1rm')).toBeUndefined()
    expect(detectPersonalRecords(working(80, 5), [{ weightKg: 70, reps: 20 }]).find(p => p.type === 'e1rm')).toBeUndefined()
  })

  it('returns nothing for a set without weight or reps', () => {
    expect(detectPersonalRecords({ weightKg: null, reps: 10, isWarmup: false }, [{ weightKg: 50, reps: 5 }])).toEqual([])
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/shared/lib/personal-records.test.ts`
Expected: FAIL, module not found.

**Step 3: Implement**

```ts
// shared/lib/personal-records.ts
import { round1 } from '~~/shared/lib/formulas'

export type PrType = 'weight' | 'reps' | 'e1rm'

export interface DetectedPr {
  type: PrType
  value: number
  previousValue: number
}

interface LoggedSet {
  weightKg: number | null
  reps: number | null
}

// Epley becomes unreliable at high reps, so sets above this never set or beat an e1RM.
export const E1RM_MAX_REPS = 12

export const estimateOneRepMax = (weightKg: number, reps: number): number => weightKg * (1 + reps / 30)

const isComplete = (s: LoggedSet): s is { weightKg: number, reps: number } =>
  s.weightKg !== null && s.reps !== null && s.reps > 0

/**
 * Compares one set against every earlier *working* set of the same exercise. No history means
 * no PR: the first session establishes the baseline rather than rewarding it.
 */
export const detectPersonalRecords = (
  set: LoggedSet & { isWarmup: boolean },
  priorWorkingSets: LoggedSet[],
): DetectedPr[] => {
  if (set.isWarmup || !isComplete(set)) return []
  const prior = priorWorkingSets.filter(isComplete)
  if (prior.length === 0) return []

  const prs: DetectedPr[] = []

  const bestWeight = Math.max(...prior.map(s => s.weightKg))
  if (set.weightKg > bestWeight) prs.push({ type: 'weight', value: set.weightKg, previousValue: bestWeight })

  const atOrAbove = prior.filter(s => s.weightKg >= set.weightKg)
  if (atOrAbove.length > 0) {
    const bestReps = Math.max(...atOrAbove.map(s => s.reps))
    if (set.reps > bestReps) prs.push({ type: 'reps', value: set.reps, previousValue: bestReps })
  }

  const eligible = prior.filter(s => s.reps <= E1RM_MAX_REPS)
  if (set.reps <= E1RM_MAX_REPS && eligible.length > 0) {
    const best = Math.max(...eligible.map(s => estimateOneRepMax(s.weightKg, s.reps)))
    const mine = estimateOneRepMax(set.weightKg, set.reps)
    if (round1(mine) > round1(best)) prs.push({ type: 'e1rm', value: round1(mine), previousValue: round1(best) })
  }

  return prs
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/shared/lib/personal-records.test.ts`
Expected: PASS (10 tests).

**Step 5: Commit**

```bash
git add shared/lib/personal-records.ts tests/shared/lib/personal-records.test.ts
git commit -m "feat(prs): detect weight, rep and estimated-1RM personal records"
```

---

### Task 8: `personal_records` table and repository

**Files:**
- Modify: `server/database/schema.sql` (append)
- Create: `server/repositories/personal-record.repository.ts`
- Create: `tests/server/repositories/personal-record.repository.test.ts`
- Modify: `server/repositories/session.repository.ts` (new `findWorkingSetsBefore`)
- Modify: `shared/types/session.types.ts` (`SessionPrHit`), `shared/types/home.types.ts` (`RecentPr`)

**Step 1: Schema**

Append to `schema.sql`:

```sql
-- One row per PR type a working set achieved (a set can be a weight, rep and e1RM PR at once).
-- Replaces reading PRs out of xp_ledger('pr'): XP is a reward, this is the training record.
CREATE TABLE IF NOT EXISTS personal_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id    TEXT NOT NULL REFERENCES exercises(id),
  set_log_id     TEXT NOT NULL REFERENCES set_logs(id) ON DELETE CASCADE,
  pr_type        TEXT NOT NULL CHECK (pr_type IN ('weight','reps','e1rm')),
  value          REAL NOT NULL,
  previous_value REAL NOT NULL,
  achieved_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (set_log_id, pr_type)
);

CREATE INDEX IF NOT EXISTS idx_personal_records_user ON personal_records(user_id, achieved_at);
```

**Step 2: Types**

```ts
// shared/types/session.types.ts
export interface SessionPrHit {
  exerciseName: string
  weightKg: number
  reps: number
  prTypes: PrType[]
  e1rmKg: number | null   // set when prTypes includes 'e1rm'
}
```

```ts
// shared/types/home.types.ts
export interface RecentPr extends SessionPrHit {
  achievedAt: string
}
```

(Import `PrType` from `~~/shared/lib/personal-records`, and `SessionPrHit` into `home.types.ts`.)

**Step 3: Write the failing repository tests**

```ts
// tests/server/repositories/personal-record.repository.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'

describe('PersonalRecordRepository', () => {
  let db: Client
  let sessions: SessionRepository
  let repo: PersonalRecordRepository

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    repo = new PersonalRecordRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`)
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'e1', setNumber: 1, weightKg: 100, reps: 5, rpe: null })
  })

  const record = () => repo.insertMany({
    userId: 'user-1', exerciseId: 'bench-press', setLogId: 'set-1', achievedAt: '2026-01-01 10:00:00',
    prs: [{ type: 'weight', value: 100, previousValue: 95 }, { type: 'e1rm', value: 116.7, previousValue: 110 }],
  })

  it('groups a set\'s PR types for the session summary', async () => {
    await record()
    expect(await repo.findForSession('user-1', 's1')).toEqual([
      { exerciseName: 'Bench Press', weightKg: 100, reps: 5, prTypes: ['e1rm', 'weight'], e1rmKg: 116.7 },
    ])
  })

  it('is idempotent per (set, type)', async () => {
    await record()
    await record()
    expect((await db.execute('SELECT COUNT(*) AS n FROM personal_records')).rows[0]!.n).toBe(2)
  })

  it('lists recent PRs newest first with an optional limit', async () => {
    await record()
    const recent = await repo.recent('user-1', 5)
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({ exerciseName: 'Bench Press', prTypes: ['e1rm', 'weight'], achievedAt: '2026-01-01 10:00:00' })
  })

  it('deletes a set\'s PRs', async () => {
    await record()
    await repo.deleteForSet('set-1')
    expect(await repo.findForSession('user-1', 's1')).toEqual([])
  })

  it('cascades when the set is deleted', async () => {
    await record()
    await sessions.deleteSetLog('set-1')
    expect((await db.execute('SELECT COUNT(*) AS n FROM personal_records')).rows[0]!.n).toBe(0)
  })
})
```

Add to `session.repository.test.ts`:

```ts
describe('SessionRepository.findWorkingSetsBefore', () => {
  it('returns earlier working sets of the exercise, excluding warm-ups and the set itself', async () => {
    const db = await createTestDb()
    const repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await repo.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 40, reps: 10, rpe: null, isWarmup: true })
    await repo.logSet({ id: 'b', exerciseLogId: 'e1', setNumber: 2, weightKg: 80, reps: 8, rpe: null })
    await repo.logSet({ id: 'c', exerciseLogId: 'e1', setNumber: 3, weightKg: 85, reps: 6, rpe: null })

    expect(await repo.findWorkingSetsBefore('user-1', 'bench-press', 'c')).toEqual([{ weightKg: 80, reps: 8 }])
  })
})
```

**Step 4: Run to verify failure**

Run: `npx vitest run tests/server/repositories/personal-record.repository.test.ts tests/server/repositories/session.repository.test.ts`
Expected: FAIL, module not found / not a function.

**Step 5: Implement**

```ts
// server/repositories/personal-record.repository.ts
import type { Client } from '@libsql/client'
import type { DetectedPr, PrType } from '~~/shared/lib/personal-records'
import type { SessionPrHit } from '~~/shared/types/session.types'
import type { RecentPr } from '~~/shared/types/home.types'

export class PersonalRecordRepository {
  constructor(private db: Client) {}

  async insertMany(input: { userId: string, exerciseId: string, setLogId: string, achievedAt: string, prs: DetectedPr[] }): Promise<void> {
    for (const pr of input.prs) {
      await this.db.execute({
        sql: `INSERT INTO personal_records (user_id, exercise_id, set_log_id, pr_type, value, previous_value, achieved_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (set_log_id, pr_type) DO NOTHING`,
        args: [input.userId, input.exerciseId, input.setLogId, pr.type, pr.value, pr.previousValue, input.achievedAt],
      })
    }
  }

  async deleteForSet(setLogId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM personal_records WHERE set_log_id = ?', args: [setLogId] })
  }

  // One row per PR *set*, with its PR types folded together, so "Bench 100kg × 5" appears once
  // even when it was simultaneously a weight and an e1RM PR.
  private groupedSql(where: string, limit: boolean) {
    return `SELECT e.name AS exercise_name, sl.weight_kg, sl.reps, MAX(pr.achieved_at) AS achieved_at,
                   GROUP_CONCAT(pr.pr_type) AS pr_types,
                   MAX(CASE WHEN pr.pr_type = 'e1rm' THEN pr.value END) AS e1rm_kg
            FROM personal_records pr
            JOIN set_logs sl ON sl.id = pr.set_log_id
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN exercises e ON e.id = pr.exercise_id
            WHERE ${where}
            GROUP BY pr.set_log_id
            ORDER BY achieved_at DESC, sl.logged_at DESC
            ${limit ? 'LIMIT ?' : ''}`
  }

  private mapHit(row: Record<string, unknown>): SessionPrHit {
    return {
      exerciseName: row.exercise_name as string,
      weightKg: row.weight_kg as number,
      reps: row.reps as number,
      prTypes: (row.pr_types as string).split(',').sort() as PrType[],
      e1rmKg: (row.e1rm_kg as number | null) ?? null,
    }
  }

  async findForSession(userId: string, sessionId: string): Promise<SessionPrHit[]> {
    const result = await this.db.execute({ sql: this.groupedSql('pr.user_id = ? AND el.session_id = ?', false), args: [userId, sessionId] })
    return result.rows.map(row => this.mapHit(row as unknown as Record<string, unknown>))
  }

  async recent(userId: string, limit?: number): Promise<RecentPr[]> {
    const result = await this.db.execute({
      sql: this.groupedSql('pr.user_id = ?', limit !== undefined),
      args: limit !== undefined ? [userId, limit] : [userId],
    })
    return result.rows.map(row => ({
      ...this.mapHit(row as unknown as Record<string, unknown>),
      achievedAt: (row as unknown as Record<string, unknown>).achieved_at as string,
    }))
  }
}
```

In `SessionRepository`:

```ts
  // PR baseline for one set: every earlier working set of the same exercise by this user,
  // ordered by (logged_at, rowid) so a replayed or edited set is compared only against what came
  // before it, never against itself or later sets.
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
```

**Step 6: Run to verify pass**

Run: `npx vitest run tests/server/repositories/personal-record.repository.test.ts tests/server/repositories/session.repository.test.ts`
Expected: PASS. (If the cascade test fails, foreign keys aren't enforced on the local client.
Delete that test and rely on the explicit `deleteForSet` call added in Task 9.)

**Step 7: Commit**

```bash
git add server/database/schema.sql server/repositories/personal-record.repository.ts server/repositories/session.repository.ts shared/types tests/server/repositories
git commit -m "feat(prs): store personal records in their own table"
```

---

### Task 9: Log / edit / delete sets through `SessionService`

**Files:**
- Modify: `server/services/gamification.service.ts` (`revokeSetRewards`)
- Modify: `server/repositories/xp.repository.ts` (`revoke`)
- Modify: `server/services/session.service.ts` (`logSet`, `editSet`, `deleteSet`)
- Modify: `server/api/sessions/[id]/sets.post.ts`, `server/api/sessions/[id]/sets/[setId].patch.ts`, `server/api/sessions/[id]/sets/[setId].delete.ts`
- Delete: `server/utils/pr.ts`, `tests/server/utils/pr.test.ts`
- Test: `tests/server/services/session.service.test.ts`, `tests/server/repositories/xp.repository.test.ts`

**Step 1: Write the failing tests**

`xp.repository.test.ts`:

```ts
  it('revokes an award so it can no longer be counted', async () => {
    await repo.award('user-1', 50, 'pr', 'set-1')
    await repo.revoke('user-1', 'pr', 'set-1')
    expect(await repo.totalForUser('user-1')).toBe(0)
  })
```

`session.service.test.ts`, new `describe`:

```ts
describe('SessionService set logging', () => {
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
    service = new SessionService(ctx(), sessions, new BlockRepository(db), gamification, xp, streaks, { personalRecords: prs })
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
  })

  const log = (id: string, weightKg: number, reps: number) =>
    service.logSet({ id, exerciseLogId: 'e1', setNumber: 1, weightKg, reps, rpe: null })

  it('awards 10 XP per set', async () => {
    await log('set-1', 60, 8)
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(1)
  })

  it('does not treat a first-ever set as a PR', async () => {
    await log('set-1', 60, 8)
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
  })

  it('records PR types and awards the PR bonus once per set', async () => {
    await log('set-1', 60, 8)
    await log('set-2', 65, 8)
    expect((await prs.findForSession('user-1', 's1'))[0]!.prTypes).toEqual(['e1rm', 'weight'])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(1)
  })

  it('revokes set and PR XP when the set is deleted', async () => {
    await log('set-1', 60, 8)
    await log('set-2', 65, 8)
    await service.deleteSet('set-2')
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(1)
    expect(await prs.findForSession('user-1', 's1')).toEqual([])
  })

  it('re-detects PRs when a set is edited', async () => {
    await log('set-1', 60, 8)
    const pr = await log('set-2', 65, 8)
    await service.editSet(pr.id, pr.version, { weightKg: 55 })
    expect(await prs.findForSession('user-1', 's1')).toEqual([])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
  })

  it('rejects logging to someone else\'s exercise log', async () => {
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    const other = new SessionService(ctx('user-2'), sessions, new BlockRepository(db), {} as never, xp, new StreakRepository(db), { personalRecords: prs })
    await expect(other.logSet({ id: 'x', exerciseLogId: 'e1', setNumber: 1, weightKg: 1, reps: 1, rpe: null })).rejects.toThrow(/forbidden/i)
  })
})
```

Add imports: `GamificationService`, `AchievementRepository`, `PersonalRecordRepository`.

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/services/session.service.test.ts tests/server/repositories/xp.repository.test.ts`
Expected: FAIL, `revoke` / `logSet` not functions.

**Step 3: Implement**

`XpRepository`:

```ts
  async revoke(userId: string, sourceType: XpSourceType, sourceId: string): Promise<void> {
    await this.db.execute({
      sql: 'DELETE FROM xp_ledger WHERE user_id = ? AND source_type = ? AND source_id = ?',
      args: [userId, sourceType, sourceId],
    })
  }
```

`GamificationService`:

```ts
  // Called when a set is deleted (both rewards) or edited (PR only, before re-detection), so a
  // fake PR can't be logged, deleted and re-logged under a fresh id for repeated XP.
  async revokeSetRewards(userId: string, setId: string, options: { includeSetXp: boolean }): Promise<void> {
    await this.xp.revoke(userId, 'pr', setId)
    if (options.includeSetXp) await this.xp.revoke(userId, 'set_logged', setId)
  }
```

`SessionService` (import `detectPersonalRecords`, `LogSetInput`, `EditSetLogInput`, `SetLog`):

```ts
  private get personalRecords(): PersonalRecordRepository {
    if (!this.deps.personalRecords) throw new Error('SessionService: personalRecords repository not provided')
    return this.deps.personalRecords
  }

  private async requireOwnedExerciseLog(exerciseLogId: string) {
    const ownerId = await this.sessions.findExerciseLogOwnerId(exerciseLogId)
    if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Exercise log not found' })
    this.requireOwner(ownerId)
  }

  private async requireOwnedSet(setLogId: string) {
    const ownerId = await this.sessions.findSetLogOwnerId(setLogId)
    if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Set log not found' })
    this.requireOwner(ownerId)
  }

  async logSet(input: LogSetInput): Promise<SetLog> {
    await this.requireOwnedExerciseLog(input.exerciseLogId)
    const setLog = await this.sessions.logSet(input)
    try {
      await this.gamification.onSetLogged(this.ctx.userId, setLog.id)
      await this.recordPersonalRecords(setLog)
    } catch (error) {
      console.error('SessionService.logSet: rewards/PR detection failed after set logged', { setLogId: setLog.id, error })
    }
    return setLog
  }

  async editSet(setLogId: string, expectedVersion: number, corrections: EditSetLogInput) {
    await this.requireOwnedSet(setLogId)
    const result = await this.sessions.editSetLog(setLogId, expectedVersion, corrections)
    if (result.conflict) return result
    try {
      await this.personalRecords.deleteForSet(setLogId)
      await this.gamification.revokeSetRewards(this.ctx.userId, setLogId, { includeSetXp: false })
      await this.recordPersonalRecords(result.setLog)
    } catch (error) {
      console.error('SessionService.editSet: PR re-detection failed after set edited', { setLogId, error })
    }
    return result
  }

  async deleteSet(setLogId: string): Promise<void> {
    await this.requireOwnedSet(setLogId)
    await this.personalRecords.deleteForSet(setLogId)
    await this.gamification.revokeSetRewards(this.ctx.userId, setLogId, { includeSetXp: true })
    await this.sessions.deleteSetLog(setLogId)
  }

  private async recordPersonalRecords(setLog: SetLog): Promise<void> {
    const exerciseId = await this.sessions.findExerciseIdForLog(setLog.exerciseLogId)
    if (!exerciseId) return
    const prior = await this.sessions.findWorkingSetsBefore(this.ctx.userId, exerciseId, setLog.id)
    const prs = detectPersonalRecords(setLog, prior)
    if (prs.length === 0) return
    await this.personalRecords.insertMany({ userId: this.ctx.userId, exerciseId, setLogId: setLog.id, achievedAt: setLog.loggedAt, prs })
    await this.gamification.onPrHit(this.ctx.userId, setLog.id)
  }
```

The three routes each build the service the same way as Task 6's route (plus
`personalRecords: new PersonalRecordRepository(db)`) and call `service.logSet(body-mapped input)`,
`service.editSet(setId, body.expectedVersion, corrections)` (keeping the existing 409 throw on
`result.conflict`), and `service.deleteSet(setId)`. Remove the inline ownership checks and
`isNewPersonalRecord` usage from the routes. Delete `server/utils/pr.ts` and its test.

Extract the repeated construction into `server/utils/session-service.ts` so four routes don't
copy it:

```ts
import type { H3Event } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
// ...repository and service imports

export const useSessionService = async (event: H3Event): Promise<SessionService> => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const sessions = new SessionRepository(db)
  const xp = new XpRepository(db)
  const streaks = new StreakRepository(db)
  const gamification = new GamificationService(xp, streaks, new AchievementRepository(db), sessions)
  return new SessionService(ctx, sessions, new BlockRepository(db), gamification, xp, streaks, {
    exercises: new ExerciseRepository(db),
    profiles: new ProfileRepository(db),
    personalRecords: new PersonalRecordRepository(db),
  })
}
```

Use it in `sessions/index.post.ts`, `sets.post.ts`, `[setId].patch.ts`, `[setId].delete.ts`
and `complete.post.ts`.

**Step 4: Run to verify pass**

Run: `npx vitest run`
Expected: all pass.

**Step 5: Commit**

```bash
git add server tests
git commit -m "feat(sessions): route set logging through SessionService; award set XP and revoke rewards on delete/edit"
```

---

### Task 10: Read PRs from `personal_records`

**Files:**
- Modify: `server/services/session.service.ts` (`completeSession` summary)
- Modify: `server/services/home.service.ts`, `server/services/workouts.service.ts` (recent PRs)
- Modify: `server/api/stats/pr-history.get.ts`
- Modify: `server/repositories/xp.repository.ts` (remove `recentPrs`, `findPrsForSession`)
- Tests: `session.service.test.ts` (the summary test), `home.service.test.ts`, `workouts.service.test.ts`, `xp.repository.test.ts`

**Step 1: Update tests first**

- In the summary test in `session.service.test.ts`, replace `await xp.award('user-1', 50, 'pr', 'set-working')` with
  `await prs.insertMany({ userId: 'user-1', exerciseId: 'bench-press', setLogId: 'set-working', achievedAt: '2026-01-01 10:00:00', prs: [{ type: 'weight', value: 100, previousValue: 95 }] })`,
  and expect `prsHit` to equal `[{ exerciseName: 'Bench Press', weightKg: 100, reps: 5, prTypes: ['weight'], e1rmKg: null }]`.
- In the home and workouts service tests, seed PRs the same way and assert the new shape.
- Remove the `recentPrs` / `findPrsForSession` tests from `xp.repository.test.ts`.

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/services`
Expected: FAIL on shape / source.

**Step 3: Implement**

- `SessionService.completeSession`: `this.xp.findPrsForSession(...)` → `this.personalRecords.findForSession(...)`.
- `HomeService` / `WorkoutsService`: `this.xp.recentPrs(userId, N)` → `personalRecords.recent(userId, N)`. Add `PersonalRecordRepository` to their constructors and to every route and test that constructs them (`grep -rn "new HomeService\|new WorkoutsService" server tests`).
- `pr-history.get.ts`: `new PersonalRecordRepository(db).recent(ctx.userId, limit)`.
- Delete `XpRepository.recentPrs` and `findPrsForSession`.

**Step 4: Run to verify pass**

Run: `npx vitest run && npx nuxi typecheck`
Expected: tests pass, no new type errors. Type errors in `app/` point at Task 13's display changes. Fix the type-only breaks now (e.g. `pr.weightKg` still exists); richer display comes in Task 13.

**Step 5: Commit**

```bash
git add server tests shared
git commit -m "feat(prs): read session, recent and historical PRs from personal_records"
```

---

### Task 11: Backfill existing PRs

**Files:**
- Create: `server/database/backfill-personal-records.ts`
- Create: `tests/server/database/backfill-personal-records.test.ts`
- Modify: `package.json` (script)

**Step 1: Write the failing test**

```ts
// tests/server/database/backfill-personal-records.test.ts
import { describe, expect, it } from 'vitest'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { backfillPersonalRecords } from '~~/server/database/backfill-personal-records'

describe('backfillPersonalRecords', () => {
  it('replays working sets in order and records PRs, idempotently', async () => {
    const db = await createTestDb()
    const sessions = new SessionRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`)
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null })
    await sessions.logSet({ id: 'b', exerciseLogId: 'e1', setNumber: 2, weightKg: 65, reps: 8, rpe: null })
    await sessions.logSet({ id: 'c', exerciseLogId: 'e1', setNumber: 3, weightKg: 65, reps: 9, rpe: null })

    await backfillPersonalRecords(db)
    await backfillPersonalRecords(db)

    const rows = (await db.execute('SELECT set_log_id, pr_type FROM personal_records ORDER BY set_log_id, pr_type')).rows
    expect(rows.map(r => `${r.set_log_id}:${r.pr_type}`)).toEqual(['b:e1rm', 'b:weight', 'c:e1rm', 'c:reps'])
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/database/backfill-personal-records.test.ts`
Expected: FAIL, module not found.

**Step 3: Implement**

```ts
// server/database/backfill-personal-records.ts
import type { Client } from '@libsql/client'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { detectPersonalRecords } from '~~/shared/lib/personal-records'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'

// One-off: populates personal_records from existing set_logs, replaying each user's working
// sets per exercise in logged order through the same detector used at log time. Existing
// xp_ledger('pr') rows are left untouched. Safe to re-run (inserts are ON CONFLICT DO NOTHING).
export const backfillPersonalRecords = async (db: Client): Promise<void> => {
  const result = await db.execute(`
    SELECT sl.id, sl.weight_kg, sl.reps, sl.is_warmup, sl.logged_at, ws.user_id, el.exercise_id
    FROM set_logs sl
    JOIN exercise_logs el ON el.id = sl.exercise_log_id
    JOIN workout_sessions ws ON ws.id = el.session_id
    ORDER BY ws.user_id, el.exercise_id, sl.logged_at, sl.rowid
  `)
  const repo = new PersonalRecordRepository(db)
  const history = new Map<string, { weightKg: number | null, reps: number | null }[]>()

  for (const row of result.rows) {
    const key = `${row.user_id}|${row.exercise_id}`
    const prior = history.get(key) ?? []
    const set = { weightKg: row.weight_kg as number | null, reps: row.reps as number | null, isWarmup: Boolean(row.is_warmup) }
    const prs = detectPersonalRecords(set, prior)
    if (prs.length > 0) {
      await repo.insertMany({ userId: row.user_id as string, exerciseId: row.exercise_id as string, setLogId: row.id as string, achievedAt: row.logged_at as string, prs })
    }
    if (!set.isWarmup) prior.push({ weightKg: set.weightKg, reps: set.reps })
    history.set(key, prior)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in the environment.')
    process.exit(1)
  }
  await backfillPersonalRecords(createClient({ url, authToken }))
  console.log('Backfilled personal records.')
}
```

`package.json` scripts: `"db:backfill-prs": "tsx --env-file=.env server/database/backfill-personal-records.ts"`.

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/database/backfill-personal-records.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/database/backfill-personal-records.ts tests/server/database/backfill-personal-records.test.ts package.json
git commit -m "feat(prs): add a backfill script for personal_records"
```

---

### Task 12: Builder rep-range input

**Files:**
- Modify: `app/components/builder/DayExercisePicker.vue` (the reps field)

No unit tests (repo convention: Vue components aren't unit-tested).

**Step 1: Replace the reps input** with a min–max pair, keeping the current row layout (a
grid with "N sets × M reps" as plain `Input`s on their own line, from `b397d8c`). Change
the single reps `Input` to two `Input`s joined by an en dash, like this:

```vue
<Input
  :model-value="exercise.targetRepsMin ?? ''"
  type="number"
  placeholder="min"
  aria-label="Minimum reps"
  class="h-9 w-14 py-0"
  @update:model-value="(v) => setRepsMin(exercise, v)"
/>
–
<Input
  :model-value="exercise.targetRepsMax ?? ''"
  type="number"
  placeholder="max"
  aria-label="Maximum reps"
  class="h-9 w-14 py-0"
  @update:model-value="(v) => setRepsMax(exercise, v)"
/>
reps
```

Check it still fits at about 360px alongside the sets input.

with, in `<script setup>`:

```ts
// Keeps min <= max as either end moves, rather than rejecting the edit: raising min past max
// drags max up with it, and lowering max below min drags min down.
const setRepsMin = (exercise: { targetRepsMin: number | null, targetRepsMax: number | null }, value: string | number) => {
  const min = value === '' ? null : Number(value)
  exercise.targetRepsMin = min
  if (min !== null && (exercise.targetRepsMax === null || exercise.targetRepsMax < min)) exercise.targetRepsMax = min
}
const setRepsMax = (exercise: { targetRepsMin: number | null, targetRepsMax: number | null }, value: string | number) => {
  const max = value === '' ? null : Number(value)
  exercise.targetRepsMax = max
  if (max !== null && exercise.targetRepsMin !== null && exercise.targetRepsMin > max) exercise.targetRepsMin = max
}
```

**Step 2: Verify manually**

Run: `npm run dev`. Open `/builder`, add an exercise, set 8–10, raise min to 12 (max follows to 12), save the split, reopen via `/builder-edit/<id>`, and confirm 12–12 persisted.

**Step 3: Commit**

```bash
git add app/components/builder/DayExercisePicker.vue
git commit -m "feat(builder): edit prescriptions as a min–max rep range"
```

---

### Task 13: Session page suggestion line, pre-fill, PR types, "Next time"

**Files:**
- Create: `shared/lib/suggestion-copy.ts` + `tests/shared/lib/suggestion-copy.test.ts`
- Modify: `app/pages/workouts/session/[id].vue`
- Modify: `app/pages/index.vue`, `app/pages/workouts/index.vue`, `app/pages/stats.vue` (PR rows)

**Step 1: Write failing tests for display copy**

```ts
// tests/shared/lib/suggestion-copy.test.ts
import { describe, expect, it } from 'vitest'
import { describeSuggestion, formatPrTypes } from '~~/shared/lib/suggestion-copy'

describe('describeSuggestion', () => {
  it('formats an increase with its reason', () => {
    expect(describeSuggestion({ action: 'increase', reason: 'all_sets_top_of_range', weightKg: 62.5, repsMin: 8, repsMax: 10 }, 'metric')).toEqual({
      line: 'Today: 62.5kg × 8–10',
      glyph: '↑',
      reason: 'All sets hit the top of the range last time — add weight.',
    })
  })

  it('formats imperial loads in pounds', () => {
    expect(describeSuggestion({ action: 'hold', reason: 'building_reps', weightKg: 102.0582, repsMin: 8, repsMax: 10 }, 'imperial').line)
      .toBe('Today: 225lb × 8–10')
  })

  it('omits weight for bodyweight progressions', () => {
    expect(describeSuggestion({ action: 'increase', reason: 'all_sets_top_of_range', weightKg: null, repsMin: 11, repsMax: 12 }, 'metric').line)
      .toBe('Today: 11–12 reps')
  })
})

describe('formatPrTypes', () => {
  it('labels each type', () => {
    expect(formatPrTypes(['e1rm', 'reps', 'weight'], 116.7)).toBe('Weight · Reps · e1RM 116.7kg')
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/shared/lib/suggestion-copy.test.ts`
Expected: FAIL, module not found.

**Step 3: Implement**

```ts
// shared/lib/suggestion-copy.ts
import { kgToLbs, round1 } from '~~/shared/lib/formulas'
import type { PrType } from '~~/shared/lib/personal-records'
import type { ProgressionSuggestion, SuggestionAction, SuggestionReason, UnitSystem } from '~~/shared/lib/progression'

// English copy keyed by reason. The Arabic/RTL work replaces this map with i18n keys of the
// same names (see docs/plans/2026-09-14-arabic-rtl-design.md).
const REASONS: Record<SuggestionReason, string> = {
  first_time: 'First time logging this — pick a weight you could do a couple more reps with.',
  missed_min_twice: 'Missed the bottom of the range two sessions running — back off and rebuild.',
  rpe_too_high: 'Last time felt much harder than prescribed — keep the weight.',
  all_sets_top_of_range: 'All sets hit the top of the range last time — add weight.',
  rpe_too_low: 'Last time felt much easier than prescribed — add weight.',
  building_reps: 'Same weight — aim for more reps than last time.',
}

const GLYPHS: Record<SuggestionAction, string> = { increase: '↑', hold: '=', reduce: '↓', first_time: '•' }

export const formatLoad = (weightKg: number, unitSystem: UnitSystem): string =>
  unitSystem === 'imperial' ? `${Math.round(kgToLbs(weightKg))}lb` : `${round1(weightKg)}kg`

const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`)

export const describeSuggestion = (suggestion: ProgressionSuggestion, unitSystem: UnitSystem) => ({
  line: suggestion.weightKg === null
    ? `Today: ${range(suggestion.repsMin, suggestion.repsMax)} reps`
    : `Today: ${formatLoad(suggestion.weightKg, unitSystem)} × ${range(suggestion.repsMin, suggestion.repsMax)}`,
  glyph: GLYPHS[suggestion.action],
  reason: REASONS[suggestion.reason],
})

const PR_LABELS: Record<PrType, string> = { weight: 'Weight', reps: 'Reps', e1rm: 'e1RM' }
const PR_ORDER: PrType[] = ['weight', 'reps', 'e1rm']

export const formatPrTypes = (types: PrType[], e1rmKg: number | null): string =>
  PR_ORDER.filter(t => types.includes(t))
    .map(t => (t === 'e1rm' && e1rmKg !== null ? `e1RM ${round1(e1rmKg)}kg` : PR_LABELS[t]))
    .join(' · ')
```

Run: `npx vitest run tests/shared/lib/suggestion-copy.test.ts` → PASS.

**Step 4: Session page**

In `app/pages/workouts/session/[id].vue`:

- In `exerciseDisplayInfo`, add
  `suggestionInfo: exercise.suggestion ? describeSuggestion(exercise.suggestion, unitSystem.value) : null`.
  Import `describeSuggestion` from `~~/shared/lib/suggestion-copy`.
- Under the Target/Last line in both the straight-sets card and the circuit row, render:

```vue
<button
  v-if="exercise.suggestionInfo && exercise.suggestion?.action !== 'first_time'"
  type="button"
  class="font-mono text-xs uppercase tracking-[1.2px] text-foreground"
  @click="expandedReason[exercise.id] = !expandedReason[exercise.id]"
>
  {{ exercise.suggestionInfo.line }} {{ exercise.suggestionInfo.glyph }}
</button>
<p v-if="expandedReason[exercise.id]" class="text-xs text-muted-foreground">{{ exercise.suggestionInfo?.reason }}</p>
```

with `const expandedReason = reactive<Record<string, boolean>>({})`.

- **Pre-fill: integrate with the existing last-session seeding, don't replace it.** The
  page already fills each working set's draft from the same set last session
  (`suggestedSetValues`, used by the `seededDrafts` `watchEffect` and by `logNextSet`). The
  progression suggestion changes what that fill should be:
  - `increase` / `reduce` with a `weightKg`: for every working set, use the suggested weight
    (not last session's), with reps from the suggestion's `repsMin`. Last session's per-set
    weights no longer apply once the load changes. This includes ramping patterns: pre-fill
    the suggested working weight, and let the lifter adjust.
  - `hold`: keep today's behaviour (last session's matching set, or the set just logged).
  - `first_time` or no suggestion: keep today's behaviour.
  - Bodyweight `increase` (`weightKg` null): keep the weight behaviour, use the suggestion's
    `repsMin` for reps.

  Implement this by giving `suggestedSetValues` the exercise's `suggestion` and applying
  those rules. Put the rule selection in a pure helper in `shared/lib/progression.ts` (e.g.
  `prefillForSet({ suggestion, previousSet, justLogged })`) with unit tests, and keep the
  Vue side a thin call. The per-set "Set N last time" hint stays as it is.
  Weight is stored and entered in kg on this page.

- **"Next time" card** in the completion summary: compute client-side from the
  just-finished session with `suggestProgression`, keeping only `increase` results:

```ts
const nextTime = computed(() => {
  if (!completionSummary.value || !session.value) return []
  return session.value.exercises.flatMap((exercise) => {
    const suggestion = suggestProgression({
      prescription: { sets: exercise.targetSets, repsMin: exercise.targetRepsMin, repsMax: exercise.targetRepsMax, rpe: exercise.targetRpe },
      recentSessions: [exercise.sets.filter(s => !s.isWarmup)],
      setType: exercise.setType,
      equipment: equipmentByExerciseId.value.get(exercise.exerciseId) ?? null,
      movementPattern: null, // not on the page; lower-body barbell lifts show +2.5 here, and start-of-session snapshots use the real +5
      unitSystem: unitSystem.value,
    })
    return suggestion?.action === 'increase' && suggestion.weightKg !== null
      ? [{ name: exercise.exerciseName ?? exercise.exerciseId, load: formatLoad(suggestion.weightKg, unitSystem.value) }]
      : []
  })
})
```

Render as a `UiCard` titled "Next time", with rows "{{ name }} → {{ load }}", shown when
`nextTime.length > 0`. The circuit/missed-min-twice cases aren't shown here because
`recentSessions` has only one session. That's intended.

To make the "+5 for lower body" estimate exact, extend `useExercisesByIds` consumers to
read `movementPattern` (already on the `Exercise` type) via a `patternByExerciseId` map
alongside `equipmentByExerciseId`, and pass it instead of `null`. Do this; the comment above
is the fallback only if the field is missing.

- **PR rows** (`completionSummary.prsHit`, `index.vue` recent PRs, `workouts/index.vue`, `stats.vue`):
  add a muted line `{{ formatPrTypes(pr.prTypes, pr.e1rmKg) }}` under each existing
  `{{ pr.weightKg }}kg × {{ pr.reps }}`.

**Step 5: Verify manually**

`npm run db:seed:dummy` against a dev database, then `npm run dev`:
1. Start today's workout. Exercises with dummy history show "Today: …" with a glyph, and tapping it shows the reason.
2. The first set's kg/reps inputs are pre-filled; a changed value logs the changed value.
3. Log a heavier set than history. Finish. The summary lists the PR with "Weight · e1RM …", and "Next time" lists exercises whose sets all hit the top.
4. Delete that set before finishing. The PR disappears from the summary, and Home XP drops by 60.

**Step 6: Commit**

```bash
git add shared/lib/suggestion-copy.ts tests/shared/lib/suggestion-copy.test.ts app/pages
git commit -m "feat(session): show progression suggestions, pre-fill from them, and label PR types"
```

---

### Task 14: Final verification

**Step 1:** `npx vitest run` → all pass. Record the count in the PR description.
**Step 2:** `npx nuxi typecheck` → no new errors.
**Step 3:** `npx eslint .` → clean.
**Step 4:** Update `README.md`:
- Workout logging → "PR detection" now covers weight / rep / e1RM PRs, and first sets set the baseline.
- New bullet "Progression suggestions".
- XP bullet: 10 per set is now true; rewards are revoked when a set is deleted.
- Scripts table: add `db:backfill-prs`.

**Step 5:** Commit: `git add README.md && git commit -m "docs: describe progression suggestions and PR types"`.
**Step 6:** Deploy order for an existing database:
1. `npm run db:seed` runs `migrateRepRanges` (expand only, `target_reps` kept) and the new schema.
2. Verify: every table has `target_reps_min` / `target_reps_max`, preset rows are widened, and the
   running (old) build still works.
3. Deploy the app.
4. `npm run db:backfill-rep-ranges` fills rows the old build wrote between step 1 and step 3. It is
   idempotent, so re-run it if old clients kept writing for a while.
5. `npm run db:backfill-prs`.

---

### Task 15: Contract rep-range migration (later release)

**Ship this only after every client has updated** to a build that sends and reads
`targetRepsMin` / `targetRepsMax`. PWA clients can run a stale bundle for a long time, so wait
until the old build is no longer seen, not just until the new one is deployed.

Tasks 1–2 shipped the *expand* half. `migrateRepRanges` adds and fills `target_reps_min` /
`target_reps_max` but keeps `target_reps`. The repositories dual-write `target_reps` as the range
minimum, fall back to `target_reps` on read when both ends are NULL, and accept a legacy `targetReps`
payload. `backfillRepRanges` (`npm run db:backfill-rep-ranges`) fills rows that only have
`target_reps`. This task removes all of that.

The release runs in three separate steps, in this order:
1. **Backfill:** `npm run db:backfill-rep-ranges` against the live database, so no row depends on the
   read fallback.
2. **Deploy the fallback-free build** (Step 3 below). It no longer reads or writes `target_reps`.
3. **Drop migration:** `npm run db:seed` runs `migrateDropTargetReps` (Step 2). It re-runs the same
   `backfillRepRanges` before dropping, as a safety net for rows written between steps 1 and 2.

**Files:**
- Create: `server/database/migrations/drop-target-reps.ts`, `tests/server/database/drop-target-reps-migration.test.ts`
- Modify: `server/database/seed.ts` (run the new migration after `migrateRepRanges`), `server/database/schema.sql`, `server/repositories/rep-range-columns.ts` and its callers in `block`, `preset-split` and `session` repositories, `server/services/workouts.service.ts`, `server/api/sessions/index.post.ts` (OpenAPI), `shared/types/*.types.ts`, `server/database/seed-dummy.ts`, repository and service tests

**Step 1: Write the failing migration test.** Build a database with `target_reps`, `target_reps_min`
and `target_reps_max`. Include rows with min/max set, and rows with only `target_reps` set in all
three tables, as old code would have written them after the expand. Expect:
- the legacy rows backfilled, with presets widened
- `target_reps` gone from every table
- an open-ended range such as (8, NULL) is untouched
- a re-run is a no-op

**Step 2: Implement `migrateDropTargetReps`.** First `await backfillRepRanges(db)` from
`server/database/backfill-rep-ranges.ts`, the same function the CLI runs. It only touches rows with
both ends NULL and `target_reps` set. Then, for each table that still has `target_reps`,
`db.migrate([ALTER TABLE <table> DROP COLUMN target_reps])`.

**Step 3: Stop the dual-write and drop the fallback.**
- Remove `target_reps` from every insert and from `repRangeArgs`.
- `repRangeFromRow` reads only `target_reps_min` / `target_reps_max`.
- Remove the legacy `targetReps` payload normalization.
- Remove the legacy `targetReps` response field: the `// TODO(Task 15)` sites in `rep-range-columns.ts` and `workouts.service.ts`, and the `@deprecated targetReps?` fields on `SplitExercise`, `PresetSplitExercise`, `TodaysWorkoutExercise` and `ExerciseLog`.
- Delete the dual-write and fallback repository tests, and the legacy-payload tests.

**Step 4: Drop `target_reps` from `schema.sql`** in all three tables, including the deprecated comment.

**Step 5: Verify.** `grep -rn "target_reps\b\|targetReps\b" app server shared tests` finds only the two
migrations and their tests. `npx vitest run`, `npx nuxi typecheck` and eslint on the changed files all pass.

**Step 6: Commit**

```bash
git add server tests
git commit -m "refactor(db): contract the rep-range migration and drop target_reps"
```

**Deploy order:** `npm run db:backfill-rep-ranges` → deploy the fallback-free build →
`npm run db:seed` (backfill again, then drop). Never run the drop before the fallback-free build is
live, because a still-running build that reads or writes `target_reps` would break.

Also remove the `db:backfill-rep-ranges` script and `backfill-rep-ranges.ts` in a release after the
drop, once no database still has `target_reps`. Or keep the function if the drop migration still
imports it.
