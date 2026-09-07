# Comprehensive Exercise Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Build the exercise-science layer the PRD specifies on top of the already-shipped split builder:
exercise tier/movement-pattern classification, a weekly volume tracker, a recovery/overuse checker, a
4-tier equipment profile with automatic exercise substitution, an exercise swap sheet, circuit/interval
split support, and 3 new preset templates (Bro Split, Mobility, Fat-Loss Circuit) alongside the 6 PRD
strength splits.

**Architecture:** Phase 0 (exercise classification) is the dependency root — Phases 2-4 all read the
`tier`/`movement_pattern` columns it adds. Movement pattern is derived entirely by deterministic rules.
Tier is deterministic except for the compound+dumbbell/kettlebell residual (~95 exercises), which is
classified by hand once and checked into the classification script as a lookup table — no external LLM
API, no new dependency, no API key. The user's only LLM access is Claude itself (this session), and
classifying ~95 exercise names by judgment is exactly the kind of task done directly rather than scripted.
Equipment-fallback matching (used by both Phase 3's substitution and Phase 4's swap sheet) is a single
shared repository method — a join query, not a maintained mapping table. Phases 1 and 5 are independent of
Phase 0 and can run in parallel with it.

**Tech Stack:** Nuxt/Nitro, `@libsql/client`, Vitest, `tsx` (for the one-time classification script,
matching `seed.ts`'s convention). No LLM SDK or API key needed — see Task 4's revision note.

**Context this plan assumes:**
- Design doc: `docs/plans/2026-09-07-exercise-engine-design.md` — read it first, especially the two
  corrections at the top (no `primary_muscle` scalar column exists; `Equipment`'s `CHECK` constraint needs
  a table-rebuild migration, not a plain `ALTER`).
- Prior plan/precedent: `docs/plans/2026-09-06-split-builder-plan.md` — the builder UI this plan extends
  (`PresetPicker.vue`, `CustomSplitEditor.vue`, `DayExercisePicker.vue`, `app/pages/builder.vue`) was just
  built there; read the actual current files before touching them; they may have evolved.
- **Schema-change convention (confirmed via git history, no exceptions)**: new columns are added as a bare
  `ALTER TABLE <table> ADD COLUMN <col> <type>;` statement in `server/database/schema.sql`, placed near
  that table's `CREATE TABLE`. `server/database/seed.ts` (and `server/utils/test/create-test-db.ts`) apply
  the *entire* file by splitting on `;` and executing every statement, silently swallowing "duplicate
  column name" errors — so this is naturally idempotent and requires no separate migration runner. Applying
  a schema change to the live Turso dev DB is just `npm run db:seed`. A constraint that SQLite can't `ALTER`
  in place (e.g. `CHECK`, dropping `NOT NULL`) uses the guarded table-rebuild technique already in
  `seed.ts`'s `migrateIngredientsUserIdNullable` — copy that pattern exactly for Task 11.
- Test conventions: `tests/server/**` mirrors `server/**`, `~~/` import alias, `createTestDb()` from
  `server/utils/test/create-test-db.ts` gives an in-memory schema-applied DB.
- Route handlers (`server/api/**`) are conventionally untested directly in this codebase — only
  repositories/services/pure functions get unit tests.

---

## Task 1: Schema — `movement_pattern` and `tier` columns on `exercises`

**Files:**
- Modify: `server/database/schema.sql`

**Step 1: Add the columns**

In `server/database/schema.sql`, immediately after the `exercises` table's `CREATE TABLE IF NOT EXISTS`
block, add:

```sql
ALTER TABLE exercises ADD COLUMN movement_pattern TEXT;
ALTER TABLE exercises ADD COLUMN tier INTEGER CHECK (tier IN (1, 2, 3));
```

Both nullable — not every exercise gets classified in the first pass (e.g. cardio/stretching rows), and
`mapRow` (Task 2) needs to handle `null` gracefully regardless.

**Step 2: Apply and verify**

Run: `npx tsx --env-file=.env server/database/seed.ts` against your local/dev DB (or just run the test
suite, which applies schema.sql fresh via `createTestDb()` — either confirms the ALTER statements are
valid SQL with no syntax errors). Run: `npx vitest run` — expect all existing tests still pass (nothing
reads these columns yet).

**Step 3: Commit**

```bash
git add server/database/schema.sql
git commit -m "feat(exercises): add movement_pattern and tier columns"
```

---

## Task 2: `classifyMovementPattern` — pure rule-based classifier

**Files:**
- Create: `server/utils/exercise-classification.ts`
- Test: `tests/server/utils/exercise-classification.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { classifyMovementPattern } from '~~/server/utils/exercise-classification'

describe('classifyMovementPattern', () => {
  it('classifies overhead/incline pressing as vertical push', () => {
    expect(classifyMovementPattern({ name: 'Overhead Press', force: 'push', mechanic: 'compound', primaryMuscles: ['shoulders'] })).toBe('vertical_push')
    expect(classifyMovementPattern({ name: 'Incline Barbell Bench Press', force: 'push', mechanic: 'compound', primaryMuscles: ['chest'] })).toBe('vertical_push')
  })

  it('classifies flat bench/chest press as horizontal push', () => {
    expect(classifyMovementPattern({ name: 'Barbell Bench Press', force: 'push', mechanic: 'compound', primaryMuscles: ['chest'] })).toBe('horizontal_push')
  })

  it('classifies rows as horizontal pull', () => {
    expect(classifyMovementPattern({ name: 'Bent Over Barbell Row', force: 'pull', mechanic: 'compound', primaryMuscles: ['middle back'] })).toBe('horizontal_pull')
  })

  it('classifies pulldowns/pull-ups as vertical pull', () => {
    expect(classifyMovementPattern({ name: 'Wide-Grip Lat Pulldown', force: 'pull', mechanic: 'compound', primaryMuscles: ['lats'] })).toBe('vertical_pull')
    expect(classifyMovementPattern({ name: 'Pullups', force: 'pull', mechanic: 'compound', primaryMuscles: ['lats'] })).toBe('vertical_pull')
  })

  it('classifies squats/leg presses/lunges as knee-dominant', () => {
    expect(classifyMovementPattern({ name: 'Barbell Squat', force: 'push', mechanic: 'compound', primaryMuscles: ['quadriceps'] })).toBe('knee_dominant')
    expect(classifyMovementPattern({ name: 'Leg Press', force: 'push', mechanic: 'compound', primaryMuscles: ['quadriceps'] })).toBe('knee_dominant')
    expect(classifyMovementPattern({ name: 'Dumbbell Lunges', force: 'push', mechanic: 'compound', primaryMuscles: ['quadriceps'] })).toBe('knee_dominant')
  })

  it('classifies deadlifts/RDLs/hip thrusts as hip-dominant', () => {
    expect(classifyMovementPattern({ name: 'Romanian Deadlift', force: 'pull', mechanic: 'compound', primaryMuscles: ['hamstrings'] })).toBe('hip_dominant')
    expect(classifyMovementPattern({ name: 'Barbell Hip Thrust', force: 'pull', mechanic: 'compound', primaryMuscles: ['glutes'] })).toBe('hip_dominant')
  })

  it('classifies curls as elbow flexion', () => {
    expect(classifyMovementPattern({ name: 'Dumbbell Bicep Curl', force: 'pull', mechanic: 'isolation', primaryMuscles: ['biceps'] })).toBe('elbow_flexion')
  })

  it('classifies pushdowns/extensions/dips as elbow extension', () => {
    expect(classifyMovementPattern({ name: 'Triceps Pushdown', force: 'push', mechanic: 'isolation', primaryMuscles: ['triceps'] })).toBe('elbow_extension')
    expect(classifyMovementPattern({ name: 'Overhead Triceps Extension', force: 'push', mechanic: 'isolation', primaryMuscles: ['triceps'] })).toBe('elbow_extension')
  })

  it('classifies ab/core-primary exercises as core', () => {
    expect(classifyMovementPattern({ name: 'Hanging Leg Raise', force: 'pull', mechanic: 'isolation', primaryMuscles: ['abdominals'] })).toBe('core')
  })

  it('falls back to lateral_isolation for lateral raises and unmatched isolation work', () => {
    expect(classifyMovementPattern({ name: 'Side Lateral Raise', force: 'push', mechanic: 'isolation', primaryMuscles: ['shoulders'] })).toBe('lateral_isolation')
  })

  it('returns null when there is not enough signal to classify confidently', () => {
    expect(classifyMovementPattern({ name: 'Foam Roll', force: null, mechanic: null, primaryMuscles: [] })).toBeNull()
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/utils/exercise-classification.test.ts`
Expected: FAIL — module doesn't exist yet.

**Step 3: Implement**

```ts
export type MovementPattern =
  | 'horizontal_push' | 'vertical_push'
  | 'horizontal_pull' | 'vertical_pull'
  | 'knee_dominant' | 'hip_dominant'
  | 'elbow_flexion' | 'elbow_extension'
  | 'lateral_isolation' | 'core'

interface ClassifiableExercise {
  name: string
  force: string | null
  mechanic: string | null
  primaryMuscles: string[]
}

const nameHas = (name: string, ...keywords: string[]): boolean => {
  const lower = name.toLowerCase()
  return keywords.some(k => lower.includes(k))
}

export const classifyMovementPattern = (exercise: ClassifiableExercise): MovementPattern | null => {
  const { name, force, primaryMuscles } = exercise
  const muscle = primaryMuscles[0]

  if (muscle === 'abdominals') return 'core'

  if (nameHas(name, 'curl') && !nameHas(name, 'leg curl')) return 'elbow_flexion'
  if (nameHas(name, 'pushdown', 'triceps extension', 'skull crusher', 'dip')) return 'elbow_extension'

  if (nameHas(name, 'deadlift', 'rdl', 'hip thrust', 'good morning', 'hip hinge')) return 'hip_dominant'
  if (nameHas(name, 'squat', 'leg press', 'lunge', 'split squat', 'step up', 'step-up', 'leg extension')) return 'knee_dominant'

  if (nameHas(name, 'pulldown', 'pull-up', 'pullup', 'pull up', 'chin-up', 'chinup')) return 'vertical_pull'
  if (nameHas(name, 'row')) return 'horizontal_pull'

  if (nameHas(name, 'incline', 'overhead press', 'shoulder press', 'military press')) return 'vertical_push'
  if (nameHas(name, 'bench press', 'chest press', 'push-up', 'push up', 'pushup', 'flye', 'fly', 'dip')) return 'horizontal_push'

  if (nameHas(name, 'lateral raise', 'rear delt', 'reverse fly', 'face pull')) return 'lateral_isolation'

  // Coarser fallback from force + muscle when name-matching didn't hit.
  if (muscle === 'quadriceps') return 'knee_dominant'
  if (muscle === 'hamstrings' || muscle === 'glutes') return 'hip_dominant'
  if (muscle === 'biceps') return 'elbow_flexion'
  if (muscle === 'triceps') return 'elbow_extension'
  if (force === 'push' && (muscle === 'chest' || muscle === 'shoulders')) return 'horizontal_push'
  if (force === 'pull' && (muscle === 'lats' || muscle === 'middle back' || muscle === 'traps')) return 'horizontal_pull'
  if (force === 'push' && muscle === 'shoulders') return 'lateral_isolation'

  return null
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/utils/exercise-classification.test.ts`
Expected: PASS. If a case fails, adjust the rule ordering (more specific name-matches must run before
coarser force/muscle fallbacks) rather than special-casing — re-run until all pass.

**Step 5: Commit**

```bash
git add server/utils/exercise-classification.ts tests/server/utils/exercise-classification.test.ts
git commit -m "feat(exercises): add rule-based movement-pattern classifier"
```

---

## Task 3: `classifyTierDeterministic` — pure rule-based tier classifier

**Files:**
- Modify: `server/utils/exercise-classification.ts`
- Test: `tests/server/utils/exercise-classification.test.ts`

**Step 1: Write the failing tests**

Add to the same test file:

```ts
import { classifyTierDeterministic } from '~~/server/utils/exercise-classification'

describe('classifyTierDeterministic', () => {
  it('classifies isolation exercises as Tier 3 regardless of equipment', () => {
    expect(classifyTierDeterministic({ mechanic: 'isolation', equipment: 'cable' })).toBe(3)
    expect(classifyTierDeterministic({ mechanic: 'isolation', equipment: 'barbell' })).toBe(3)
  })

  it('classifies compound barbell/bodyweight exercises as Tier 1', () => {
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'barbell' })).toBe(1)
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'body only' })).toBe(1)
  })

  it('classifies compound machine/cable/smith exercises as Tier 2', () => {
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'machine' })).toBe(2)
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'cable' })).toBe(2)
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'smith machine' })).toBe(2)
  })

  it('returns null for compound dumbbell exercises (ambiguous, needs LLM pass)', () => {
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'dumbbell' })).toBeNull()
  })

  it('defaults to Tier 2 when mechanic is unknown', () => {
    expect(classifyTierDeterministic({ mechanic: null, equipment: 'kettlebells' })).toBe(2)
  })
})
```

**Step 2: Run to verify failure**, **Step 3: Implement**:

```ts
export const classifyTierDeterministic = (exercise: { mechanic: string | null, equipment: string | null }): 1 | 2 | 3 | null => {
  if (exercise.mechanic === 'isolation') return 3
  if (exercise.mechanic === null) return 2
  // mechanic === 'compound' from here
  if (exercise.equipment === 'barbell' || exercise.equipment === 'body only') return 1
  if (exercise.equipment === 'machine' || exercise.equipment === 'cable' || exercise.equipment === 'smith machine') return 2
  if (exercise.equipment === 'dumbbell') return null // ambiguous — Task 4's LLM pass resolves this
  return 2 // other equipment (kettlebells, bands, etc.) treated as Tier 2 by default
}
```

**Step 4: Run to verify pass. Step 5: Commit:**

```bash
git add server/utils/exercise-classification.ts tests/server/utils/exercise-classification.test.ts
git commit -m "feat(exercises): add deterministic tier classifier"
```

---

## Task 4: One-time classification script (deterministic pass + hardcoded residual table)

**Revision note**: the original version of this task called out to an external LLM API for the ambiguous
compound+dumbbell residual. The user has no separate LLM API access — they only use Claude (this session).
Since classifying ~95 ambiguous exercise names by judgment is exactly the kind of task an LLM does
directly, there is no need for a script to call out to anything at runtime: **the classification is done
once, by hand/by-Claude, as a hardcoded lookup table checked into the script itself**, not computed live.
No new dependency, no API key, no `.env` change.

This also folds in a fix surfaced by Task 3's own code-quality review: `classifyTierDeterministic`'s
"any other equipment" catch-all silently defaults 35% of compound exercises (174 of 494) to Tier 2,
mixing genuinely-Tier-1 movements (heavy kettlebell cleans/presses/squats, strongman-style lifts) with
genuinely-Tier-3 ones (band work, medicine-ball throws) with no distinction. Widen the ambiguous set this
task resolves by hand to **compound + (dumbbell OR kettlebells)** — 95 exercises total, still small and
tractable — rather than just the 46 compound-dumbbell ones.

**Files:**
- Modify: `server/utils/exercise-classification.ts` (widen the ambiguous-residual condition)
- Modify: `tests/server/utils/exercise-classification.test.ts` (add a kettlebells case)
- Create: `server/database/classify-exercises.ts`
- Modify: `package.json` (add a script entry)

**Step 1: Widen `classifyTierDeterministic`'s ambiguous residual**

In `server/utils/exercise-classification.ts`, change:
```ts
  if (exercise.equipment === 'dumbbell') return null // ambiguous — Task 4's LLM pass resolves this
  return 2 // other equipment (kettlebells, bands, etc.) treated as Tier 2 by default
```
to:
```ts
  if (exercise.equipment === 'dumbbell' || exercise.equipment === 'kettlebells') return null // ambiguous — resolved by the hardcoded table in classify-exercises.ts
  return 2 // other equipment (bands, medicine ball, etc.) treated as Tier 2 by default
```
Add a test confirming `classifyTierDeterministic({ mechanic: 'compound', equipment: 'kettlebells' })`
returns `null`. Run the existing test file, confirm the prior `mechanic: null, equipment: 'kettlebells'`
test (a *different* case — mechanic is null there, not compound) still passes unchanged. Commit this small
change on its own first:
```bash
git add server/utils/exercise-classification.ts tests/server/utils/exercise-classification.test.ts
git commit -m "fix(exercises): also treat compound kettlebell exercises as an ambiguous tier residual"
```

**Step 2: Classify the 95 ambiguous exercises directly**

Query the real dataset for the exact residual set (`mechanic: 'compound'` and `equipment` in
`('dumbbell', 'kettlebells')`) and classify each by name, applying the Tier 1 vs. Tier 2 criteria from the
design doc (Tier 1 = foundational/bilateral/primary-lift-in-its-category; Tier 2 = unilateral variant,
named modifier like "Incline"/"Decline"/"Close-Grip"/"One-Arm", or a technical/ballistic/skill-focused
kettlebell movement not typically used as a session's main strength assessment). Below is a reference
classification already produced this way — sanity-check it against the actual current dataset (exercise
names could have drifted since this plan was written) rather than trusting it blindly, and adjust any call
that looks wrong to you:

```ts
const AMBIGUOUS_TIER_OVERRIDES: Record<string, 1 | 2> = {
  'Arnold Dumbbell Press': 1, 'Bent Over Two-Dumbbell Row': 1, 'Dumbbell Bench Press': 1,
  'Dumbbell Lunges': 1, 'Dumbbell Rear Lunge': 1, 'Dumbbell Shoulder Press': 1, 'Dumbbell Squat': 1,
  'Front Squats With Two Kettlebells': 1, 'Goblet Squat': 1, 'Incline Dumbbell Press': 1,
  'One-Arm Dumbbell Row': 1, 'Seated Dumbbell Press': 1, 'Standing Dumbbell Press': 1,
  'Stiff-Legged Dumbbell Deadlift': 1, 'Two-Arm Kettlebell Jerk': 1, 'Two-Arm Kettlebell Military Press': 1,
  'Two-Arm Kettlebell Row': 1, 'Bulgarian Split Squat': 1, 'Split Squat with Dumbbells': 1,
  'Double Kettlebell Jerk': 1, 'Double Kettlebell Push Press': 1,
  // Everything else in the residual set defaults to 2 (see below) — this list is the Tier-1 allowlist,
  // not an exhaustive map of all 95 names, to keep it maintainable as the shorter of the two lists.
}
```

Every ambiguous exercise NOT in this allowlist defaults to Tier 2 — this keeps the checked-in table short
(only the Tier-1 exceptions need listing) while still resolving the full residual, since Tier 2 is the far
more common outcome for unilateral/variant/technical movements in this bucket. When you regenerate this
list against the live dataset, re-derive it yourself (don't just copy the block above unexamined) — if a
name in the real data isn't covered by your own judgment pass, it falls to Tier 2 by the same default,
which is a safe direction to err (Tier 2 is the "supplemental," not "ignored," bucket).

**Step 3: Implement the script**

Follow `server/database/seed.ts`'s exact shape (standalone `tsx` script, `createClient` from env vars
directly, `main().catch(...).finally(() => db.close())`):

```ts
import { createClient } from '@libsql/client'
import { classifyMovementPattern, classifyTierDeterministic } from '~~/server/utils/exercise-classification'

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
})

// AMBIGUOUS_TIER_OVERRIDES from Step 2 goes here.

async function main() {
  const result = await db.execute('SELECT * FROM exercises')
  const rows = result.rows as unknown as Record<string, unknown>[]

  let ruleClassified = 0
  let overrideClassified = 0
  let defaultedAmbiguous = 0
  const samples: { id: string, name: string, tier: number | null, pattern: string | null }[] = []

  for (const row of rows) {
    const primaryMusclesResult = await db.execute({
      sql: `SELECT muscles.name FROM exercise_muscles JOIN muscles ON muscles.id = exercise_muscles.muscle_id WHERE exercise_muscles.exercise_id = ? AND exercise_muscles.role = 'primary'`,
      args: [row.id as string],
    })
    const primaryMuscles = primaryMusclesResult.rows.map(r => r.name as string)
    const exercise = {
      name: row.name as string,
      force: row.force as string | null,
      mechanic: row.mechanic as string | null,
      equipment: row.equipment as string | null,
      primaryMuscles,
    }

    const movementPattern = classifyMovementPattern(exercise)
    let tier = classifyTierDeterministic(exercise)

    if (tier === null) {
      if (exercise.name in AMBIGUOUS_TIER_OVERRIDES) {
        tier = AMBIGUOUS_TIER_OVERRIDES[exercise.name]!
        overrideClassified++
      } else {
        tier = 2 // safe default for anything in the residual set not explicitly listed
        defaultedAmbiguous++
      }
    } else {
      ruleClassified++
    }

    await db.execute({
      sql: 'UPDATE exercises SET movement_pattern = ?, tier = ? WHERE id = ?',
      args: [movementPattern, tier, row.id as string],
    })

    if (samples.length < 30 && Math.random() < 0.05) {
      samples.push({ id: row.id as string, name: exercise.name, tier, pattern: movementPattern })
    }
  }

  console.log(`Classified ${rows.length} exercises: ${ruleClassified} by rule, ${overrideClassified} by the hardcoded residual table, ${defaultedAmbiguous} ambiguous names defaulted to Tier 2 (not in the table — review these).`)
  console.log('Spot-check sample:')
  console.table(samples)
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => db.close())
```

Add to `package.json` scripts: `"db:classify-exercises": "tsx --env-file=.env server/database/classify-exercises.ts"`.

**Step 4: Manual verification**

Run: `npm run db:classify-exercises` against the dev DB. Review the printed spot-check table by eye —
does "Barbell Squat" read Tier 1 / knee_dominant? Does "Triceps Pushdown" read Tier 3 / elbow_extension?
Pay particular attention to the `defaultedAmbiguous` count printed — if it's non-zero, those are ambiguous
names your `AMBIGUOUS_TIER_OVERRIDES` table didn't cover (e.g. the real dataset has names not on the
reference list above); query them directly (`SELECT name FROM exercises WHERE tier = 2 AND mechanic =
'compound' AND equipment IN ('dumbbell','kettlebells')`) and decide whether any deserve a Tier-1 override,
adding them to the table and re-running (the script is fully idempotent — it overwrites, doesn't append).

Then spot-check via direct query:
```sql
SELECT name, mechanic, equipment, tier, movement_pattern FROM exercises WHERE tier IS NULL;
```
Expected: zero rows — every exercise gets a tier now (rule-based, hardcoded override, or the Tier-2
default), unlike the movement_pattern column which can legitimately stay `NULL` for low-signal names.

**Step 5: Commit**

```bash
git add server/database/classify-exercises.ts package.json
git commit -m "feat(exercises): add one-time classification script with hand-classified ambiguous residual"
```

---

## Task 5: `Exercise` type and `ExerciseRepository.mapRow` — surface the new columns

**Files:**
- Modify: `shared/types/exercise.types.ts`
- Modify: `server/repositories/exercise.repository.ts`
- Test: `tests/server/repositories/exercise.repository.test.ts`

**Step 1: Write the failing test**

Add to the existing `describe('ExerciseRepository', ...)` block:

```ts
  it('surfaces tier and movementPattern on findById', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions, movement_pattern, tier)
            VALUES ('squat', 'Barbell Squat', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]', 'knee_dominant', 1)`,
    })
    const found = await repo.findById('squat')
    expect(found?.tier).toBe(1)
    expect(found?.movementPattern).toBe('knee_dominant')
  })

  it('surfaces null tier/movementPattern for unclassified exercises', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('plank', 'Plank', 'strength', null, 'static', 'beginner', 'isolation', '[]')`,
    })
    const found = await repo.findById('plank')
    expect(found?.tier).toBeNull()
    expect(found?.movementPattern).toBeNull()
  })
```

**Step 2: Run to verify failure**

**Step 3: Implement**

`shared/types/exercise.types.ts` — add to the `Exercise` interface:
```ts
  tier: 1 | 2 | 3 | null
  movementPattern: string | null
```

`server/repositories/exercise.repository.ts`'s `mapRow` — add:
```ts
      tier: row.tier as 1 | 2 | 3 | null,
      movementPattern: row.movement_pattern as string | null,
```

**Step 4: Run to verify pass. Step 5: Commit:**

```bash
git add shared/types/exercise.types.ts server/repositories/exercise.repository.ts tests/server/repositories/exercise.repository.test.ts
git commit -m "feat(exercises): surface tier and movementPattern on Exercise"
```

---

## Task 6: `ExerciseRepository.findFallbacks` — shared substitution/swap query

**Files:**
- Modify: `server/repositories/exercise.repository.ts`
- Test: `tests/server/repositories/exercise.repository.test.ts`

This is the one query shared by Phase 3 (equipment substitution) and Phase 4 (swap sheet) — build it once.

**Step 1: Write the failing tests**

```ts
  it('finds fallback exercises sharing movement pattern and primary muscle', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')

    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('bb-bench', 'Barbell Bench Press', 'barbell', 'compound', 'horizontal_push', 1)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('db-bench', 'Dumbbell Bench Press', 'dumbbell', 'compound', 'horizontal_push', 1)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('pushup', 'Push-Up', 'body only', 'compound', 'horizontal_push', 1)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('leg-press', 'Leg Press', 'machine', 'compound', 'knee_dominant', 2)` })
    for (const id of ['bb-bench', 'db-bench', 'pushup', 'leg-press']) {
      await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: [id, chest.id, 'primary'] })
    }

    const fallbacks = await repo.findFallbacks('bb-bench', ['dumbbell', 'body only'])
    expect(fallbacks.map(e => e.id).sort()).toEqual(['db-bench', 'pushup'])
  })

  it('excludes the source exercise itself and orders by tier proximity then name', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('src', 'Source', 'barbell', 'compound', 'horizontal_push', 1)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('t3', 'Zzz Isolation', 'cable', 'isolation', 'horizontal_push', 3)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('t1', 'Aaa Compound', 'body only', 'compound', 'horizontal_push', 1)` })
    for (const id of ['src', 't3', 't1']) {
      await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: [id, chest.id, 'primary'] })
    }

    const fallbacks = await repo.findFallbacks('src', ['cable', 'body only'])
    expect(fallbacks.map(e => e.id)).toEqual(['t1', 't3']) // t1 (tier 1, closest) before t3 (tier 3)
  })
```

**Step 2: Run to verify failure**

**Step 3: Implement**

```ts
  async findFallbacks(exerciseId: string, equipmentTiers: string[]): Promise<Exercise[]> {
    if (equipmentTiers.length === 0) return []
    const source = await this.findById(exerciseId)
    if (!source || !source.movementPattern) return []

    const primaryMuscleResult = await this.db.execute({
      sql: `SELECT muscle_id FROM exercise_muscles WHERE exercise_id = ? AND role = 'primary' LIMIT 1`,
      args: [exerciseId],
    })
    const primaryMuscleId = (primaryMuscleResult.rows[0] as unknown as Record<string, unknown> | undefined)?.muscle_id
    if (primaryMuscleId === undefined) return []

    const placeholders = equipmentTiers.map(() => '?').join(', ')
    const result = await this.db.execute({
      sql: `SELECT e2.* FROM exercises e2
            JOIN exercise_muscles em2 ON em2.exercise_id = e2.id AND em2.role = 'primary'
            WHERE e2.movement_pattern = ?
              AND em2.muscle_id = ?
              AND e2.equipment IN (${placeholders})
              AND e2.id != ?
            ORDER BY ABS(COALESCE(e2.tier, 2) - ?), e2.name`,
      args: [source.movementPattern, primaryMuscleId, ...equipmentTiers, exerciseId, source.tier ?? 2],
    })
    const exercises = result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
    return this.attachDetails(exercises)
  }
```

**Step 4: Run to verify pass. Step 5: Commit:**

```bash
git add server/repositories/exercise.repository.ts tests/server/repositories/exercise.repository.test.ts
git commit -m "feat(exercises): add findFallbacks for equipment substitution and swap"
```

---

## Task 7: Weekly Volume Tracker — repository method

**Files:**
- Modify: `server/repositories/session.repository.ts`
- Test: `tests/server/repositories/session.repository.test.ts`

**Step 1: Write the failing test**

Add a new `describe` block:

```ts
describe('SessionRepository.weeklySetsByMuscle', () => {
  it('counts distinct logged sets per primary muscle within a date range', async () => {
    const db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench', '[]')" })
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: ['bench-press', chest.id, 'primary'] })

    const repo = new SessionRepository(db)
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
    await repo.logSet({ id: 'set-2', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 8, rpe: 7 })

    const results = await repo.weeklySetsByMuscle('user-1', '2020-01-01 00:00:00', '2030-01-01 00:00:00')
    expect(results).toEqual([{ muscleId: chest.id, muscleName: 'chest', setCount: 2 }])
  })

  it('only counts sets within the given date range', async () => {
    // Reuse the setup above conceptually: assert a range excluding "now" (e.g. a range entirely in the past)
    // returns setCount 0 / an empty array for that muscle. Follow volumeKgInRange's existing date-range test
    // for the exact pattern this repo already uses to control "now" in tests.
  })
})
```

(Fill in the second test by following whatever pattern `volumeKgInRange`'s own existing tests already use
for controlling/asserting date-range boundaries — read that test first rather than guessing a new
approach.)

**Step 2: Run to verify failure**

**Step 3: Implement**

Add immediately after `volumeKgInRange` in `server/repositories/session.repository.ts`:

```ts
  async weeklySetsByMuscle(userId: string, startIso: string, endIso: string): Promise<{ muscleId: number, muscleName: string, setCount: number }[]> {
    const result = await this.db.execute({
      sql: `SELECT muscles.id AS muscle_id, muscles.name AS muscle_name, COUNT(DISTINCT sl.id) AS set_count
            FROM set_logs sl
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN workout_sessions ws ON ws.id = el.session_id
            JOIN exercise_muscles em ON em.exercise_id = el.exercise_id AND em.role = 'primary'
            JOIN muscles ON muscles.id = em.muscle_id
            WHERE ws.user_id = ? AND sl.logged_at >= ? AND sl.logged_at < ?
            GROUP BY muscles.id
            ORDER BY set_count DESC`,
      args: [userId, startIso, endIso],
    })
    return result.rows.map((row) => {
      const r = row as unknown as Record<string, unknown>
      return { muscleId: r.muscle_id as number, muscleName: r.muscle_name as string, setCount: r.set_count as number }
    })
  }
```

**Step 4: Run to verify pass. Step 5: Commit:**

```bash
git add server/repositories/session.repository.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat(sessions): add weeklySetsByMuscle for the volume tracker"
```

---

## Task 8: Weekly Volume Tracker — service, endpoint, composable, UI card

**Files:**
- Modify: `server/services/workouts.service.ts` (or wherever `WorkoutsService`/a suitable service lives —
  confirm current structure first)
- Create: `server/api/workouts/weekly-volume.get.ts`
- Modify: `app/composables/query-keys.ts`
- Create: `app/composables/useWeeklyVolume.ts`
- Modify: `app/pages/workouts/index.vue`

**Step 1: Service method**

Add a `getWeeklyVolume(userId)` method to whatever service already computes weekly-scoped facts (check
`WorkoutsService`/`SessionService` for the existing `startOfWeek`/`toSqliteDatetime` pattern used in
`SessionService.completeSession` — reuse that exact date-range construction, don't reinvent it), calling
`this.sessions.weeklySetsByMuscle(userId, weekStart, weekEnd)` and mapping each row to
`{ muscleName, setCount, band: 'low' | 'optimal' | 'high' }` where `band` is `setCount < 10 ? 'low' :
setCount > 22 ? 'high' : 'optimal'` (thresholds straight from the design doc's cited MAV research — don't
adjust them without re-checking that sourcing).

**Step 2: Route**

`server/api/workouts/weekly-volume.get.ts` — thin handler: `getRequestContext` → service call → return.
Match the exact shape of a sibling simple GET route (`server/api/exercises/index.get.ts` from the prior
plan is a good template).

**Step 3: Query key + composable**

`query-keys.ts`: `weeklyVolume: () => ['weekly-volume'] as const`. `useWeeklyVolume.ts`: a plain
no-argument `useQuery` composable, same shape as `useWorkoutsSummary`.

**Step 4: UI card**

In `app/pages/workouts/index.vue`, add a new `UiCard` between the today's-workout/empty-state block and
the Recent PRs section. Render each muscle as a labeled progress bar (`{{ muscle.setCount }} sets`)
color-banded by `band` (`low` → a muted/yellow tone, `optimal` → the app's primary/success color, `high` →
`text-destructive`/a warning tone — match whatever color tokens `app/assets/css/index.css` already defines
for these semantic states, don't invent new ones).

**Step 5: Manual verification**

`npm run dev`, log a few sets against a seeded user, confirm the card renders real counts and color-bands
correctly at the `<10`, `10-20`, `>22` boundaries (log enough sets to cross a boundary and confirm the band
changes).

**Step 6: Commit**

```bash
git add server/services/*.ts server/api/workouts/weekly-volume.get.ts app/composables/query-keys.ts app/composables/useWeeklyVolume.ts app/pages/workouts/index.vue
git commit -m "feat(workouts): add weekly volume tracker card"
```

---

## Task 9: `checkRecoveryConflicts` — pure function

**Files:**
- Create: `server/utils/recovery-checker.ts` (or `app/utils/` if this needs to run purely client-side per
  the design doc — confirm whether a pure function belongs under `server/utils` importable from `app/` via
  the `~~/` alias the way other shared logic in this codebase is imported; if cross-boundary import is
  awkward, place it under `shared/lib/` instead, matching the existing `shared/lib/formulas.ts` precedent)
- Test: co-located under `tests/server/utils/` or `tests/shared/lib/`, matching wherever you placed it

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { checkRecoveryConflicts } from '~~/shared/lib/recovery-checker'

const day = (overrides: Partial<{ isRestDay: boolean, exercises: { tier: number | null, primaryMuscle: string }[] }> = {}) => ({
  isRestDay: false,
  exercises: [],
  ...overrides,
})

describe('checkRecoveryConflicts', () => {
  it('flags two consecutive non-rest days sharing a Tier 1 exercise on the same primary muscle', () => {
    const days = [
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
    ]
    const conflicts = checkRecoveryConflicts(days)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ muscle: 'chest', dayIndexes: [0, 1] })
  })

  it('does not flag when a rest day separates two Tier 1 chest days', () => {
    const days = [
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
      day({ isRestDay: true, exercises: [] }),
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
    ]
    expect(checkRecoveryConflicts(days)).toHaveLength(0)
  })

  it('does not flag when the shared exercise is Tier 2 or 3', () => {
    const days = [
      day({ exercises: [{ tier: 2, primaryMuscle: 'chest' }] }),
      day({ exercises: [{ tier: 2, primaryMuscle: 'chest' }] }),
    ]
    expect(checkRecoveryConflicts(days)).toHaveLength(0)
  })

  it('does not flag consecutive Tier 1 days targeting different muscles', () => {
    const days = [
      day({ exercises: [{ tier: 1, primaryMuscle: 'chest' }] }),
      day({ exercises: [{ tier: 1, primaryMuscle: 'quadriceps' }] }),
    ]
    expect(checkRecoveryConflicts(days)).toHaveLength(0)
  })
})
```

**Step 2: Run to verify failure. Step 3: Implement:**

```ts
export interface RecoveryCheckDay {
  isRestDay: boolean
  exercises: { tier: number | null, primaryMuscle: string | null }[]
}

export interface RecoveryConflict {
  muscle: string
  dayIndexes: [number, number]
}

export const checkRecoveryConflicts = (days: RecoveryCheckDay[]): RecoveryConflict[] => {
  const conflicts: RecoveryConflict[] = []
  const trainingDays = days.map((day, index) => ({ day, index })).filter(({ day }) => !day.isRestDay)

  for (let i = 0; i < trainingDays.length - 1; i++) {
    const a = trainingDays[i]!
    const b = trainingDays[i + 1]!
    if (b.index !== a.index + 1) continue // a rest day sits between them in the original array

    const aTier1Muscles = new Set(a.day.exercises.filter(e => e.tier === 1 && e.primaryMuscle).map(e => e.primaryMuscle!))
    for (const exercise of b.day.exercises) {
      if (exercise.tier === 1 && exercise.primaryMuscle && aTier1Muscles.has(exercise.primaryMuscle)) {
        conflicts.push({ muscle: exercise.primaryMuscle, dayIndexes: [a.index, b.index] })
      }
    }
  }

  return conflicts
}
```

**Step 4: Run to verify pass. Step 5: Commit:**

```bash
git add shared/lib/recovery-checker.ts tests/shared/lib/recovery-checker.test.ts
git commit -m "feat(builder): add recovery-conflict checker"
```

---

## Task 10: Wire the recovery checker into the builder's confirm step

**Files:**
- Modify: `app/pages/builder.vue`

**Step 1: Implement**

In the `confirm` step, compute conflicts from whichever draft is active (`customDays.value` for the custom
path; for the preset path, the selected preset's `days` — check what shape `useRecommendedSplits`/the
selected `SplitRecommendation` actually exposes, since presets may need an extra fetch of their full day/
exercise list before conflicts can be checked — read `PresetSplitRepository.findWithDays`'s return shape to
confirm). Each exercise passed into `checkRecoveryConflicts` needs `tier`/`primaryMuscle` — for custom-mode
days built via `DayExercisePicker.vue`, this data isn't currently on `CreateSplitExerciseInput` (it only
has `exerciseId`), so you'll need to look up each exercise's `tier`/primary muscle (via the exercises
already fetched during the picker's search, cached client-side, or a small batch lookup) before running the
check — don't add a new round-trip per exercise.

Render any conflicts as a non-blocking warning banner (`text-sm`, a warning-toned background/border,
matching existing non-blocking-error styling conventions elsewhere in this app) above the Save Split
button, using the exact message format from the design doc: *"[Muscle] is targeted with heavy compound
work on back-to-back days — consider spacing these out or inserting a lower-body/rest day."* Do not disable
the Save Split button — this is advisory only, per the PRD's own framing.

**Step 2: Manual verification**

Build a custom split with two consecutive days both containing a Tier 1 exercise for the same muscle
(e.g. two days in a row with a barbell squat), confirm the warning appears; add a rest day between them,
confirm it disappears; confirm Save Split still works regardless.

**Step 3: Commit**

```bash
git add app/pages/builder.vue
git commit -m "feat(builder): surface recovery-conflict warnings in the confirm step"
```

---

## Task 11: Schema — 4-tier `Equipment` on `user_profiles` and `preset_splits` (table-rebuild migration)

**Files:**
- Modify: `server/database/schema.sql`
- Modify: `server/database/seed.ts`

**Step 1: Read `migrateIngredientsUserIdNullable` in full first**

This is the exact pattern to replicate — a guarded, idempotent table rebuild. Read it in
`server/database/seed.ts` before writing anything, and match its structure (a `PRAGMA table_info` guard,
`CREATE TABLE ..._new`, `INSERT INTO ..._new SELECT ...` with any needed value transformation, `DROP
TABLE`, `RENAME TABLE`).

**Step 2: Implement two migration functions following that exact pattern**

`migrateUserProfilesEquipmentTiers(db)`: rebuild `user_profiles` with
`equipment TEXT CHECK (equipment IN ('full_gym','home_barbell_dumbbell','home_dumbbell_only','bodyweight'))`,
copying all columns across with `equipment` remapped via `CASE equipment WHEN 'gym' THEN 'full_gym' WHEN
'home' THEN 'home_barbell_dumbbell' WHEN 'both' THEN 'home_barbell_dumbbell' ELSE equipment END` (there is
no direct old value for `bodyweight`/`home_dumbbell_only` — anyone previously on `'both'` lands on the
closest existing equivalent, `home_barbell_dumbbell`, since `'both'` doesn't survive as a *user profile*
value even though it stays valid on presets, per the design doc).

`migratePresetSplitsEquipmentTiers(db)`: rebuild `preset_splits` the same way, but preset equipment keeps
`'both'` as a valid value (presets can genuinely be equipment-agnostic) — new CHECK:
`equipment IN ('full_gym','home_barbell_dumbbell','home_dumbbell_only','bodyweight','both')`, value mapping
`gym → full_gym`, `home → home_barbell_dumbbell`, `both → both`.

Guard each with a check like: query `PRAGMA table_info(user_profiles)` (or simpler: try selecting a row
where `equipment = 'full_gym'` and skip the migration if the CHECK already permits it / the table already
has no rows using old values — follow whatever exact guard shape `migrateIngredientsUserIdNullable` uses,
don't invent a different guard style).

Call both new functions from `main()` in `seed.ts`, in the same place/order `migrateIngredientsUserIdNullable`
is currently called (before the schema.sql statement loop, per that function's own existing position).

**Step 3: Update `schema.sql`'s `CREATE TABLE` statements for `user_profiles`/`preset_splits`**

The `CREATE TABLE IF NOT EXISTS` definitions for both tables need their `equipment` CHECK updated to the
new 4/5-value list too — so a **fresh** database (test DB, new dev environment) gets the new constraint
directly, without ever needing the rebuild migration. `IF NOT EXISTS` means this is safe to edit in place
(it only ever fires the first time a table doesn't exist).

**Step 4: Verify**

Run: `npx vitest run` (the full suite re-creates a fresh test DB per test file via `createTestDb()`, so this
exercises the **updated `CREATE TABLE`**, not the migration path — confirm nothing broke). Then run the
migration for real against the dev DB: `npm run db:seed`, and manually confirm via a direct query that
existing `user_profiles`/`preset_splits` rows retained their data with remapped equipment values, and that
inserting a row with `equipment = 'home_dumbbell_only'` now succeeds where it would have failed before.

**Step 5: Commit**

```bash
git add server/database/schema.sql server/database/seed.ts
git commit -m "feat(profile): migrate equipment column to 4-tier system"
```

---

## Task 12: Widen `Equipment` type + equipment hierarchy helper + fix `scorePreset`

**Files:**
- Modify: `shared/types/preset.types.ts`
- Create: `shared/lib/equipment.ts`
- Test: `tests/shared/lib/equipment.test.ts`
- Modify: `server/services/preset-split.service.ts`
- Test: `tests/server/services/preset-split.service.test.ts`

**Step 1: Widen the type**

```ts
export type Equipment = 'full_gym' | 'home_barbell_dumbbell' | 'home_dumbbell_only' | 'bodyweight' | 'both'
```

**Step 2: Write the failing hierarchy-helper tests**

```ts
import { describe, expect, it } from 'vitest'
import { equipmentSatisfies } from '~~/shared/lib/equipment'

describe('equipmentSatisfies', () => {
  it('a tier satisfies itself and any lower tier requirement', () => {
    expect(equipmentSatisfies('full_gym', 'home_dumbbell_only')).toBe(true)
    expect(equipmentSatisfies('home_barbell_dumbbell', 'home_dumbbell_only')).toBe(true)
    expect(equipmentSatisfies('bodyweight', 'bodyweight')).toBe(true)
  })

  it('a lower tier does not satisfy a higher requirement', () => {
    expect(equipmentSatisfies('bodyweight', 'full_gym')).toBe(false)
    expect(equipmentSatisfies('home_dumbbell_only', 'home_barbell_dumbbell')).toBe(false)
  })

  it('a preset requiring "both" is satisfied by every user tier', () => {
    expect(equipmentSatisfies('bodyweight', 'both')).toBe(true)
    expect(equipmentSatisfies('full_gym', 'both')).toBe(true)
  })
})
```

**Step 3: Implement**

```ts
import type { Equipment } from '~~/shared/types/preset.types'

const TIER_ORDER: Record<Exclude<Equipment, 'both'>, number> = {
  bodyweight: 0,
  home_dumbbell_only: 1,
  home_barbell_dumbbell: 2,
  full_gym: 3,
}

export const equipmentSatisfies = (userTier: Equipment, required: Equipment): boolean => {
  if (required === 'both') return true
  if (userTier === 'both') return true // shouldn't occur for a real user profile, but fail open not closed
  return TIER_ORDER[userTier] >= TIER_ORDER[required]
}
```

**Step 4: Run to verify pass**

**Step 5: Fix `scorePreset`**

In `server/services/preset-split.service.ts`, replace:
```ts
  if (input.equipment && (preset.equipment === input.equipment || preset.equipment === 'both')) {
```
with:
```ts
  if (input.equipment && equipmentSatisfies(input.equipment, preset.equipment)) {
```
(import `equipmentSatisfies` from `~~/shared/lib/equipment`). Update `tests/server/services/preset-
split.service.test.ts`'s existing equipment-matching test(s) — read them first; at minimum add a case
confirming a `full_gym` user matches a `home_dumbbell_only` preset (this is new behavior the old flat
comparison couldn't produce), and confirm the existing `both`-preset and exact-match cases still pass
under the new comparison.

**Step 6: Run full test suite, confirm no regressions. Step 7: Commit:**

```bash
git add shared/types/preset.types.ts shared/lib/equipment.ts tests/shared/lib/equipment.test.ts server/services/preset-split.service.ts tests/server/services/preset-split.service.test.ts
git commit -m "feat(presets): widen Equipment to 4 tiers and fix hierarchy-aware matching"
```

---

## Task 13: Wire equipment into `PresetPicker.vue` and onboarding's `FifthStep.vue`

**Files:**
- Modify: `app/components/builder/PresetPicker.vue`
- Modify: `app/components/onboarding/FifthStep.vue`
- Modify: `shared/schemas/onboarding.ts`

**Step 1: `PresetPicker.vue`**

Read the current file (built in the prior plan, since gone through its own review round — confirm it
still hardcodes `equipment: null`). Change `recommendationInput` to read
`profile.value?.profile?.equipment ?? null` instead of the hardcoded `null`, mirroring exactly how
`daysPerWeek` already reads from the same `profile` query.

**Step 2: `FifthStep.vue`**

Read the current file's `equipmentOptions` array (3 entries: gym/home/both). Replace with the 4 PRD tiers
(`full_gym`, `home_barbell_dumbbell`, `home_dumbbell_only`, `bodyweight`), matching the existing
icon/title/description shape per entry — pick icons from `@lucide/vue` consistent with the rest of this
file's existing choices (check what's already imported there for stylistic continuity).

**Step 3: `shared/schemas/onboarding.ts`**

Widen the `equipment: z.enum([...])` to the 4 new values.

**Step 4: Manual verification**

`npm run dev`, run through onboarding as a new user, confirm all 4 equipment options render and save
correctly; then on `/builder` → preset path, confirm recommendations now vary by the profile's equipment
tier (compare recommendations for a `bodyweight` profile vs. a `full_gym` profile — the hierarchy fix from
Task 12 should surface different/differently-scored presets).

**Step 5: Commit**

```bash
git add app/components/builder/PresetPicker.vue app/components/onboarding/FifthStep.vue shared/schemas/onboarding.ts
git commit -m "feat(builder): wire 4-tier equipment into preset recommendations and onboarding"
```

---

## Task 14: Equipment-mismatch substitution in the custom exercise picker

**Files:**
- Modify: `app/components/builder/DayExercisePicker.vue`

**Step 1: Implement**

Read the current file (from the prior plan's Task 11, already through its own review cycles — respect its
established patterns: stable row keys, explicit `reset-search-term-on-select` control, etc.). When an
exercise is picked whose `equipment` doesn't satisfy the user's profile tier (via `equipmentSatisfies`),
instead of silently adding it, call `ExerciseRepository`'s fallback logic (via a new small endpoint —
`GET /api/exercises/:id/fallbacks?equipmentTiers=...` wrapping Task 6's `findFallbacks`, or reuse Task 16's
swap endpoint if it's built by the time you reach this task — check whether Task 16 already exists before
adding a duplicate route) and offer the top fallback as a substituted suggestion (e.g. "Barbell Squat needs
a full gym — try Bodyweight Squat instead?") rather than blocking the add outright. This needs the user's
own equipment profile available in this component — fetch it the same way `PresetPicker.vue` does
(`useProfile()`).

**Step 2: Manual verification**

As a `bodyweight`-tier profile, search for and pick a barbell-only exercise; confirm a substitution
suggestion appears rather than the exercise silently being added as picked with no equipment feedback.

**Step 3: Commit**

```bash
git add app/components/builder/DayExercisePicker.vue
git commit -m "feat(builder): suggest equipment-compatible substitutes in the exercise picker"
```

---

## Task 15: Exercise Swap Sheet — endpoint

**Files:**
- Create: `server/api/exercises/[id]/alternatives.get.ts`

**Step 1: Implement**

```ts
import { getQuery } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const id = getRouterParam(event, 'id')!
  const query = getQuery(event)
  const equipmentTiers = typeof query.equipmentTiers === 'string' ? query.equipmentTiers.split(',') : []
  return new ExerciseRepository(useDb()).findFallbacks(id, equipmentTiers)
})
```

Match `defineRouteMeta`/import conventions from sibling `server/api/exercises/*` routes exactly.

**Step 2: Manual verification**

Authenticated `GET /api/exercises/Barbell_Squat/alternatives?equipmentTiers=dumbbell,body%20only` returns a
list of same-pattern, same-muscle alternatives.

**Step 3: Commit**

```bash
git add "server/api/exercises/[id]/alternatives.get.ts"
git commit -m "feat(exercises): add GET /api/exercises/:id/alternatives endpoint"
```

---

## Task 16: Exercise Swap Sheet — UI

**Files:**
- Create: `app/components/builder/ExerciseSwapSheet.vue`
- Modify: `app/components/builder/DayExercisePicker.vue`

**Step 1: Implement**

A bottom sheet (check whether this codebase has an existing sheet/drawer primitive beyond
`ExerciseDetailDrawer.vue` — reuse its open/close and drawer-mounting pattern rather than introducing a new
one) listing alternatives from Task 15's endpoint, each row showing the exercise name + thumbnail (reuse
`ExerciseDetailDrawer`'s existing image-rendering approach). Selecting an alternative replaces the
exercise's `exerciseId` in place (preserving its `targetSets`/`targetReps`/position) rather than
appending a new row.

Wire a "Swap" affordance onto each exercise row in `DayExercisePicker.vue` that opens this sheet for that
row's exercise.

**Step 2: Manual verification**

From the custom builder, tap Swap on a picked exercise, confirm alternatives list, confirm selecting one
replaces the row in place with its sets/reps preserved.

**Step 3: Commit**

```bash
git add app/components/builder/ExerciseSwapSheet.vue app/components/builder/DayExercisePicker.vue
git commit -m "feat(builder): add exercise swap sheet"
```

---

## Task 17: Schema — circuit format columns

**Files:**
- Modify: `server/database/schema.sql`

**Step 1: Add columns**

Near `split_days`' `CREATE TABLE`:
```sql
ALTER TABLE split_days ADD COLUMN format TEXT NOT NULL DEFAULT 'straight_sets' CHECK (format IN ('straight_sets', 'circuit'));
ALTER TABLE split_days ADD COLUMN rounds INTEGER NOT NULL DEFAULT 1;
```
Near `preset_split_days`' `CREATE TABLE`, the identical pair. Near `split_exercises`' and
`preset_split_exercises`' `CREATE TABLE`s:
```sql
ALTER TABLE split_exercises ADD COLUMN rest_seconds INTEGER;
ALTER TABLE preset_split_exercises ADD COLUMN rest_seconds INTEGER;
```

**Step 2: Verify + commit**

Run `npx vitest run` (fresh test DBs pick these up via `CREATE TABLE` + the `ALTER`s applying cleanly to a
brand-new table too, since the loop just executes every statement — a `CHECK`/`DEFAULT`-bearing `ALTER
TABLE ADD COLUMN` against a table that was itself just created in the same script run is valid SQLite).

```bash
git add server/database/schema.sql
git commit -m "feat(splits): add circuit-format columns (format, rounds, rest_seconds)"
```

---

## Task 18: `BlockRepository`/`PresetSplitRepository` — read/write the new columns

**Files:**
- Modify: `server/repositories/block.repository.ts`
- Modify: `server/repositories/preset-split.repository.ts`
- Test: `tests/server/repositories/block.repository.test.ts`
- Test: `tests/server/repositories/preset-split.repository.test.ts`

**Step 1: Write failing tests**

For `BlockRepository`, add a test confirming `createWithDays` accepts and `findWithDays` returns a day with
`format: 'circuit'` and `rounds: 4`, and an exercise with `restSeconds: 30`. Mirror the exact assertion
style of the existing "creates a block with nested split days and exercises" test. Do the same for
`PresetSplitRepository`.

**Step 2: Run to verify failure**

**Step 3: Implement**

Both `createWithDays` INSERTs need `format`/`rounds` (day) and `rest_seconds` (exercise) added to their
column lists and `VALUES` placeholders — default `format` to `'straight_sets'`/`rounds` to `1` when the
input doesn't specify them (so this stays additive for every existing caller, per the design doc's own
framing — a circuit day is opt-in, not a breaking change to how straight-set days are created). Both
`findWithDays`'s manual row-mapping needs the two/one new fields added to the returned object literals.
Add `format`/`rounds` to `CreateSplitDayInput`/its preset equivalent (optional, defaulted), and
`restSeconds` to `CreateSplitExerciseInput`/its preset equivalent (optional).

**Step 4: Run to verify pass. Step 5: Commit:**

```bash
git add server/repositories/block.repository.ts server/repositories/preset-split.repository.ts tests/server/repositories/block.repository.test.ts tests/server/repositories/preset-split.repository.test.ts
git commit -m "feat(splits): read/write circuit format, rounds, and rest_seconds"
```

---

## Task 19: `'mobility'` Goal — thread through every call site

**Files:**
- Modify: `shared/types/profile.types.ts`
- Modify: `shared/schemas/onboarding.ts`
- Modify: `app/components/onboarding/ThirdStep.vue`
- Modify: `server/api/preset-splits/recommend.get.ts` (its `GOALS` const array)
- Check/modify: `server/database/seed.ts` (any goal-enumerating fixture data)

**Step 1: Widen the type**

`profile.types.ts`: `export type Goal = 'fat_loss' | 'muscle_gain' | 'maintenance' | 'general_fitness' | 'mobility'`.

**Step 2: Update every enumerated list**

`onboarding.ts`'s zod enum, `recommend.get.ts`'s `const GOALS: Goal[] = [...]`, `ThirdStep.vue`'s
`goalOptions` array (add a 5th entry — pick an icon from `@lucide/vue` fitting "mobility/flexibility," e.g.
`StretchHorizontalIcon` if it exists in the installed version, otherwise something equivalent already used
elsewhere in this codebase's icon choices). Grep for `'general_fitness'` across the repo one more time
after these edits to confirm nothing enumerating goals was missed (route validation, other zod schemas).

**Step 3: Verify**

`npx vue-tsc --noEmit`, `npx vitest run` — a `Goal` union widening is a compile-time change; TypeScript
will flag any exhaustive `switch`/mapping over `Goal` that doesn't handle the new case, so trust the
compiler here rather than manually re-auditing every file.

**Step 4: Commit**

```bash
git add shared/types/profile.types.ts shared/schemas/onboarding.ts app/components/onboarding/ThirdStep.vue server/api/preset-splits/recommend.get.ts
git commit -m "feat(profile): add mobility as a training goal"
```

---

## Task 20: Seed data — Bro Split, Mobility, Fat-Loss Circuit presets (+ verify the 6 PRD templates)

**Files:**
- Modify: `server/database/seed.ts`

**Step 1: Audit what's already seeded**

Read `seed.ts`'s existing `preset_splits` seed data in full. Cross-check against the design doc's §7 table
— confirm which of the 6 PRD strength templates (Full Body A/B, 3-day PPL, Upper/Lower, 6-day PPL, UL-PPL
Hybrid, Arnold Split) already exist vs. need adding. Do not duplicate an existing preset under a new name.

**Step 2: Add the 3 new presets**

Following the exact structure of an existing `preset_splits` seed entry (name, description,
frequency_min/max_days, goal, experience_level, equipment, days → exercises):

- **Bro Split**: 5 days (Chest / Back / Shoulders+Traps / Legs+Abs / Arms), `goal: 'muscle_gain'`,
  `experience_level: 'advanced'`, `equipment: 'full_gym'`. Pick 4-5 exercises per day from the already-
  seeded exercise catalog matching each day's target muscles (query `SELECT id, name FROM exercises WHERE
  ...` against real seeded data rather than inventing exercise ids that may not exist — verify every
  `exercise_id` referenced actually exists in the `exercises` table before writing the INSERT).
- **Mobility**: 2-3 days, full-body each session, `goal: 'mobility'`, `equipment: 'bodyweight'`. Select
  exercises via `SELECT id, name FROM exercises WHERE category = 'stretching' LIMIT ...` — spot-check the
  actual returned names before hardcoding ids, don't assume specific stretching exercise names/ids exist
  without checking.
- **Fat-Loss Circuit**: 3 days, full-body, `format: 'circuit'`, `rounds: 4`, each exercise `rest_seconds:
  20`, `goal: 'fat_loss'`. Select from `SELECT id, name FROM exercises WHERE category IN ('plyometrics',
  'cardio')`, same verify-before-hardcoding approach.

**Step 3: Manual verification**

Run `npm run db:seed`, then query `SELECT name, goal, equipment FROM preset_splits` and confirm all 9
templates exist with no duplicates. Hit `GET /api/preset-splits/recommend?daysPerWeek=3&goal=mobility` and
confirm the Mobility preset comes back scored highest.

**Step 4: Commit**

```bash
git add server/database/seed.ts
git commit -m "feat(presets): add Bro Split, Mobility, and Fat-Loss Circuit templates"
```

---

## Task 21: Full regression pass

**Step 1**: `npx vitest run` — expect everything green, including every pre-existing suite.

**Step 2**: Manual end-to-end, via API + direct DB inspection (same approach as the split-builder plan's
own Task 12, since this environment has no browser automation available by default):
- Classify exercises, confirm `tier`/`movement_pattern` populated for a sample.
- Log sets, confirm the weekly volume card reflects them with correct color-banding at the 10/22 thresholds.
- Build a custom split with a same-muscle Tier-1 back-to-back conflict, confirm the warning appears and
  Save Split still works.
- Confirm a `bodyweight`-tier profile gets `full_gym`-only exercises substituted/flagged during custom
  building, and that preset recommendations for that profile favor `bodyweight`/`home_dumbbell_only`
  presets.
- Swap an exercise via the swap sheet, confirm the row updates in place.
- Create a split from the Fat-Loss Circuit preset, confirm the resulting block's day has `format: 'circuit'`
  and `rounds`/`rest_seconds` set correctly in the database.

**Step 3**: Commit any fixes found, scoped only to files this plan touched.
