# Joint Limitations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a user mark joint areas to work around, flag exercises that commonly load those areas, rank non-flagged swaps first, and softly penalise presets full of flagged main lifts, without ever hiding an exercise.

**Architecture:** A rule function `classifyStressors` next to the existing movement-pattern classifier writes `exercise_stressors` rows from `npm run db:classify-exercises`, plus a JSON overrides file. `user_limitations` holds the user's areas. `Exercise` carries `stressors`, and the client flags by intersecting with `profile.limitations`. Swap queries take `avoid=`, and preset scoring subtracts per flagged tier-1 exercise.

**Tech Stack:** Nuxt 4 / Nitro, libSQL, Vitest, Vue 3.

**Design doc:** `docs/plans/2026-09-14-joint-limitations-design.md`

---

## Before you start

- Independent of the other 2026-09-14 plans. The in-flight `DayExercisePicker.vue` changes
  from another session (see the progression plan's "Before you start") must be landed
  before Task 7.
- `npx vitest run` green before Task 1. Commit on `main`, explicit paths, messages ending
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Joint area constants

**Files:**
- Create: `shared/lib/joint-areas.ts`

```ts
// shared/lib/joint-areas.ts
export const JOINT_AREAS = ['knee', 'shoulder', 'lower_back', 'wrist', 'elbow', 'ankle'] as const
export type JointArea = typeof JOINT_AREAS[number]

export const JOINT_AREA_LABELS: Record<JointArea, string> = {
  knee: 'Knee',
  shoulder: 'Shoulder',
  lower_back: 'Lower back',
  wrist: 'Wrist',
  elbow: 'Elbow',
  ankle: 'Ankle',
}

export const isJointArea = (value: unknown): value is JointArea =>
  typeof value === 'string' && (JOINT_AREAS as readonly string[]).includes(value)

// Areas of this exercise that the user has flagged, in canonical order.
export const conflictingAreas = (stressors: readonly JointArea[], limitations: readonly JointArea[]): JointArea[] =>
  JOINT_AREAS.filter(area => stressors.includes(area) && limitations.includes(area))
```

Commit with Task 2 (it has no behavior of its own).

---

### Task 2: `classifyStressors`

**Files:**
- Modify: `server/utils/exercise-classification.ts`
- Modify: `tests/server/utils/exercise-classification.test.ts`

**Step 1: Write the failing tests** (append)

```ts
import { classifyStressors } from '~~/server/utils/exercise-classification'

const ex = (name: string, overrides: Partial<Parameters<typeof classifyStressors>[0]> = {}) =>
  ({ name, category: 'strength', equipment: null, movementPattern: null, tier: null, ...overrides })

describe('classifyStressors', () => {
  it('flags overhead pressing, dips, upright rows and kipping for the shoulder', () => {
    expect(classifyStressors(ex('Standing Military Press', { movementPattern: 'vertical_push', equipment: 'barbell', tier: 1 }))).toContain('shoulder')
    expect(classifyStressors(ex('Dips - Triceps Version', { movementPattern: 'elbow_extension' }))).toContain('shoulder')
    expect(classifyStressors(ex('Upright Barbell Row', { movementPattern: 'horizontal_pull', equipment: 'barbell' }))).toContain('shoulder')
    expect(classifyStressors(ex('Kipping Pull-Up', { movementPattern: 'vertical_pull' }))).toContain('shoulder')
  })

  it('does not flag a flat bench press for the shoulder', () => {
    expect(classifyStressors(ex('Barbell Bench Press - Medium Grip', { movementPattern: 'horizontal_push', equipment: 'barbell', tier: 1 }))).not.toContain('shoulder')
  })

  it('flags heavy hinges, barbell squats and barbell rows for the lower back', () => {
    expect(classifyStressors(ex('Barbell Deadlift', { movementPattern: 'hip_dominant', equipment: 'barbell', tier: 1 }))).toContain('lower_back')
    expect(classifyStressors(ex('Barbell Full Squat', { movementPattern: 'knee_dominant', equipment: 'barbell', tier: 1 }))).toContain('lower_back')
    expect(classifyStressors(ex('Bent Over Barbell Row', { movementPattern: 'horizontal_pull', equipment: 'barbell', tier: 1 }))).toContain('lower_back')
    expect(classifyStressors(ex('Hyperextensions (Back Extensions)'))).toContain('lower_back')
  })

  it('does not flag a machine leg press or a tier-2 hinge for the lower back', () => {
    expect(classifyStressors(ex('Leg Press', { movementPattern: 'knee_dominant', equipment: 'machine', tier: 2 }))).not.toContain('lower_back')
    expect(classifyStressors(ex('Cable Pull Through', { movementPattern: 'hip_dominant', equipment: 'cable', tier: 2 }))).not.toContain('lower_back')
  })

  it('flags squatting, lunging, plyometrics and jumps for the knee, but not leg curls', () => {
    expect(classifyStressors(ex('Leg Press', { movementPattern: 'knee_dominant', equipment: 'machine', tier: 2 }))).toContain('knee')
    expect(classifyStressors(ex('Box Jump (Multiple Response)', { category: 'plyometrics' }))).toContain('knee')
    expect(classifyStressors(ex('Pistol Squat'))).toContain('knee')
    expect(classifyStressors(ex('Lying Leg Curls', { movementPattern: 'hip_dominant', equipment: 'machine', tier: 3 }))).not.toContain('knee')
  })

  it('flags push-ups, front squats, cleans, handstands and curls with a straight bar for the wrist', () => {
    for (const name of ['Pushups', 'Front Barbell Squat', 'Power Clean', 'Handstand Push-Ups', 'Palms-Up Barbell Wrist Curl Over A Bench', 'Barbell Curl']) {
      expect(classifyStressors(ex(name)), name).toContain('wrist')
    }
  })

  it('flags triceps extensions, dips and close-grip work for the elbow', () => {
    expect(classifyStressors(ex('EZ-Bar Skullcrusher', { movementPattern: 'elbow_extension' }))).toContain('elbow')
    expect(classifyStressors(ex('Close-Grip Barbell Bench Press', { movementPattern: 'horizontal_push' }))).toContain('elbow')
  })

  it('flags plyometrics, calf raises, lunges and sprinting for the ankle', () => {
    for (const name of ['Standing Calf Raises', 'Dumbbell Lunges', 'Sprint', 'Fast Skipping']) {
      expect(classifyStressors(ex(name)), name).toContain('ankle')
    }
  })

  it('avoids substring false positives', () => {
    expect(classifyStressors(ex('Medicine Ball Chest Pass'))).toEqual([])
    expect(classifyStressors(ex('Seated Cable Rows', { movementPattern: 'horizontal_pull', equipment: 'cable', tier: 2 }))).toEqual([])
  })

  it('returns areas in canonical order without duplicates', () => {
    const areas = classifyStressors(ex('Dips - Chest Version', { movementPattern: 'horizontal_push' }))
    expect(areas).toEqual(['shoulder', 'elbow'])
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/utils/exercise-classification.test.ts`
Expected: FAIL, `classifyStressors` is not exported.

**Step 3: Implement** (append to `exercise-classification.ts`)

> Revised after code review (verified over all 973 exercises): stretching returns no tags,
> overhead presses labelled `lateral_isolation` are recovered by name, knee drops the tier gate,
> olympic pulls skip the wrist/shoulder catch tags, close-grip only counts for pressing, and
> deadlift/good morning/calf press were added. The tests for these are in
> `tests/server/utils/exercise-classification.test.ts` and `tests/shared/lib/joint-areas.test.ts`;
> the Step 1 test block above is the original subset. The rule table lives in the design doc's
> "Tagging rules".

```ts
import { JOINT_AREAS, type JointArea } from '~~/shared/lib/joint-areas'

export interface StressorClassifiableExercise {
  name: string
  category: string | null
  equipment: string | null
  movementPattern: MovementPattern | null
  tier: number | null
}

// Which joints an exercise commonly loads, for flagging against a user's limitations. Not a
// medical model: a coarse, explainable rule set over data already on the row, reviewed via the
// per-area counts classify-exercises.ts prints, and corrected through
// exercise_stressor_overrides.json rather than more rules. Call it after the tier is resolved:
// the lower-back hinge rule reads it.
export const classifyStressors = (exercise: StressorClassifiableExercise): JointArea[] => {
  const { name, category, equipment, movementPattern: pattern, tier } = exercise
  // Stretches load joints through range, not under weight; flagging them would bury real conflicts.
  if (category === 'stretching') return []

  const plyo = category === 'plyometrics'
  const barbell = equipment === 'barbell'
  // "Jerk Dip Squat" names the dip of a jerk, not a bar dip.
  const dip = nameHas(name, 'dip') && pattern !== 'knee_dominant'
  // Clean/snatch pulls, deadlifts and shrugs stop before the catch, so they skip the rack-position
  // wrist and overhead shoulder stress of the full lift.
  const olympicPull = nameHas(name, 'pull', 'deadlift', 'shrug')
  // classifyMovementPattern labels many overhead presses lateral_isolation (via the shoulders
  // fallback, e.g. "Seated Dumbbell Press", "Push Press"), so recover them by name here.
  const overheadPress = pattern === 'vertical_push' || (pattern === 'lateral_isolation' && nameHas(name, 'press', 'jerk'))
  const areas = new Set<JointArea>()

  if (overheadPress || dip
    || nameHas(name, 'upright', 'behind the neck', 'behind neck', 'jerk', 'kipping')
    || (nameHas(name, 'snatch') && !olympicPull)) areas.add('shoulder')

  if ((pattern === 'hip_dominant' && tier === 1)
    || (pattern === 'knee_dominant' && barbell)
    || (pattern === 'horizontal_pull' && barbell)
    || nameHas(name, 'deadlift', 'good morning', 'hyperextension', 'back extension', 'clean', 'snatch')) areas.add('lower_back')

  if (pattern === 'knee_dominant' || plyo || nameHas(name, 'jump', 'pistol')) areas.add('knee')

  if ((pattern === 'elbow_flexion' && barbell)
    || nameHas(name, 'push-up', 'push up', 'pushup', 'front squat', 'front barbell squat', 'handstand', 'wrist curl', 'barbell curl')
    || (nameHas(name, 'clean') && !olympicPull)) areas.add('wrist')

  if (pattern === 'elbow_extension' || dip
    || nameHas(name, 'skullcrusher', 'skull crusher')
    || (nameHas(name, 'close-grip', 'close grip') && (pattern === 'horizontal_push' || pattern === 'vertical_push'))) areas.add('elbow')

  if (plyo || nameHas(name, 'jump', 'calf raise', 'calf press', 'lunge', 'sprint', 'skipping')) areas.add('ankle')

  return JOINT_AREAS.filter(area => areas.has(area))
}
```

Note: "Pistol Squat" in the test has no `movementPattern`, which is why `pistol` is a name
rule. Adjust fixtures, not rules, if a real catalog row's pattern differs.

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/utils/exercise-classification.test.ts`
Expected: PASS. If a fixture fails, first check whether the rule or the fixture's metadata
is wrong against the design table, and fix whichever disagrees with it.

**Step 5: Commit**

```bash
git add shared/lib/joint-areas.ts server/utils/exercise-classification.ts tests/server/utils/exercise-classification.test.ts
git commit -m "feat(exercises): classify which joints an exercise commonly loads"
```

---

### Task 3: `exercise_stressors` table, per-run rebuild and overrides

**Files:**
- Modify: `server/database/schema.sql`
- Create: `server/database/stressors.ts` (validation plus pure statement builders, used by the script and tests)
- Create: `exercise_stressor_overrides.json`
- Modify: `server/database/classify-exercises.ts`
- Create: `tests/server/database/stressors.test.ts`

**Step 1: Schema** (append)

```sql
-- Joints an exercise commonly loads (see classifyStressors). 'rule' rows are rewritten on every
-- db:classify-exercises run, while 'manual' rows come from exercise_stressor_overrides.json and
-- survive reclassification. (No semicolons in comments: the schema is split on them.)
CREATE TABLE IF NOT EXISTS exercise_stressors (
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  area        TEXT NOT NULL CHECK (area IN ('knee','shoulder','lower_back','wrist','elbow','ankle')),
  source      TEXT NOT NULL CHECK (source IN ('rule','manual')),
  PRIMARY KEY (exercise_id, area)
);
CREATE INDEX IF NOT EXISTS idx_exercise_stressors_area ON exercise_stressors(area);

CREATE TABLE IF NOT EXISTS user_limitations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area    TEXT NOT NULL CHECK (area IN ('knee','shoulder','lower_back','wrist','elbow','ankle')),
  PRIMARY KEY (user_id, area)
);
```

Also add a one-line warning to the header comment of `schema.sql`: no semicolons inside
comments, because `seed.ts` and `createTestDb` split the file on `;`.

**Step 2: Write the failing tests** in `tests/server/database/stressors.test.ts`. Each test runs
`stressorRewriteStatements(...)` through `db.batch(..., 'write')` on `createTestDb()`:

- Rule rows plus an `add` and a `remove` give the expected rows and sources.
- Repeated runs: rules `[lower_back]` with `remove lower_back` leave nothing, and a second run
  with the same inputs still leaves nothing.
- Stale manual rows: run 1 has `add ankle`, run 2 has no overrides, and the ankle row is gone.
- An `add` of an area the rules also produce ends up `manual`, and goes back to `rule` once the
  `add` is dropped.
- An unknown exercise id is skipped with one `console.warn`, and the other overrides still apply.
  (Foreign keys are enforced on libSQL, so an `add` for an unknown id would fail the batch.)
- `validateStressorOverrides` throws for a missing `overrides` key, an area that fails
  `isJointArea`, and an area in both `add` and `remove`, and accepts the shipped file.

**Step 3: Run to verify failure**

Run: `npx vitest run tests/server/database/stressors.test.ts`
Expected: FAIL, missing exports.

**Step 4: Implement** `server/database/stressors.ts`:

- `type StressorOverrides = Record<string, { add?: JointArea[], remove?: JointArea[] }>`
- `validateStressorOverrides(raw: unknown): StressorOverrides` throws a clear Error for a
  missing or non-object `overrides`, a non-array `add`/`remove`, an unknown area, or an
  add/remove overlap.
- `stressorRewriteStatements({ ruleStressors, overrides, knownExerciseIds }): InStatement[]`
  returns, in order:
  1. `DELETE FROM exercise_stressors`. Every run rebuilds the table, so the overrides file is the
     only source of `manual` rows. Deleting an `add` entry, or moving an area from `add` to
     `remove`, takes effect on the next run.
  2. A `rule` INSERT for every area in `ruleStressors`.
  3. For each override whose id is in `knownExerciseIds`: `remove` deletes that area's row, and
     `add` upserts it with `source = 'manual'`. Unknown ids are skipped with a `console.warn`.

`exercise_stressor_overrides.json` at the repo root:

```json
{
  "_comment": "Corrections to classifyStressors, keyed by exercises.id. 'add' pins an area; 'remove' drops a wrong rule-derived area. Applied after rules by npm run db:classify-exercises.",
  "overrides": {}
}
```

**Seed these overrides** (the rules get them wrong; don't add rules for them):

- `Lying_Cambered_Barbell_Row`, `Incline_Bench_Pull`, `Seal_Row`: `{ "remove": ["lower_back"] }`.
  Chest-supported rows, caught by the barbell `horizontal_pull` rule.
- `Frog_Hops`: `{ "add": ["knee", "ankle"] }`. A jump drill filed under `stretching`, which
  gets no rule tags.

In `classify-exercises.ts` `main`:

- At the top, before any DB writes, read the overrides file and pass it through
  `validateStressorOverrides`. Then check that the table exists with
  `SELECT 1 FROM exercise_stressors LIMIT 0`. If it doesn't, exit with
  "exercise_stressors table missing — run npm run db:seed first".
- In the loop, after `tier` is fully resolved (after the `AMBIGUOUS_TIER_OVERRIDES` / default-2
  fallback, since the `hip_dominant` lower-back rule reads the tier), call
  `classifyStressors({ name, category, equipment, movementPattern, tier })`. Store the result in
  a `ruleStressors` map and add it to `stressorCounts`. Leave the per-exercise
  `UPDATE exercises SET movement_pattern…` as it is.
- After the loop, build `knownExerciseIds` from the rows already loaded, then run
  `await db.batch(stressorRewriteStatements({ ruleStressors, overrides, knownExerciseIds }), 'write')`.
  That's one transaction and one round trip, so a crash leaves the previous tags intact.
- Print the per-area counts, labelled as rule-derived only (overrides aren't counted).

**Step 5: Run to verify pass**

Run: `npx vitest run tests/server/database/stressors.test.ts`
Expected: PASS.

**Step 6: Review against real data.** Run `npm run db:classify-exercises` against a dev
database and read the per-area counts. With 973 exercises, expect each area in the tens to
low hundreds. Spot-check with
`SELECT e.name FROM exercise_stressors s JOIN exercises e ON e.id = s.exercise_id WHERE s.area = 'wrist' ORDER BY random() LIMIT 25`
for each area, and add obvious mistakes to the overrides file. Don't add rules for one-offs.

**Step 7: Commit**

```bash
git add server/database/schema.sql server/database/stressors.ts server/database/classify-exercises.ts exercise_stressor_overrides.json tests/server/database/stressors.test.ts
git commit -m "feat(exercises): store joint stressor tags from classification with manual overrides"
```

---

### Task 4: Stressors on `Exercise`, `avoid` in swap queries

**Files:**
- Modify: `shared/types/exercise.types.ts`
- Modify: `server/repositories/exercise.repository.ts` (`attachDetails`, `findFallbacks`)
- Modify: `server/api/exercises/[id]/alternatives.get.ts`, `fallbacks.get.ts`
- Modify: `app/composables/useExerciseAlternatives.ts`, `useExerciseFallbacks.ts`, `query-keys.ts`
- Test: `tests/server/repositories/exercise.repository.test.ts`

**Step 1: Write the failing tests** (reuse the file's existing fallback seeding. Read it first; the sketch below assumes two same-pattern, same-primary-muscle candidates.)

```ts
  it('attaches stressor areas to exercises', async () => {
    await db.execute(`INSERT INTO exercise_stressors (exercise_id, area, source) VALUES ('<source-id>', 'shoulder', 'rule')`)
    expect((await repo.findById('<source-id>'))!.stressors).toEqual(['shoulder'])
  })

  it('orders fallbacks that avoid the given areas first', async () => {
    // <flagged-id> would normally sort first (closer tier); flag it for the shoulder.
    await db.execute(`INSERT INTO exercise_stressors (exercise_id, area, source) VALUES ('<flagged-id>', 'shoulder', 'rule')`)
    const ids = (await repo.findFallbacks('<source-id>', ['barbell', 'dumbbell'], ['shoulder'])).map(e => e.id)
    expect(ids.indexOf('<clean-id>')).toBeLessThan(ids.indexOf('<flagged-id>'))
  })
```

Replace the `<…>` placeholders with the ids the file's fixtures already create, adding a
second candidate if there is only one.

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/exercise.repository.test.ts`
Expected: FAIL.

**Step 3: Implement**

- `Exercise` gains `stressors: JointArea[]`. `mapRow` sets `stressors: []`.
- `attachDetails`: add a third query to the `Promise.all`:

```ts
      this.db.execute({
        sql: `SELECT exercise_id, area FROM exercise_stressors WHERE exercise_id IN (${placeholders})`,
        args: ids,
      }),
```

  then build `stressorsByExercise` and set `exercise.stressors = JOINT_AREAS.filter(a => (stressorsByExercise.get(exercise.id) ?? []).includes(a))`.

- `findFallbacks(exerciseId, equipmentTiers, avoid: JointArea[] = [])`: change the ORDER BY to

```sql
ORDER BY (SELECT COUNT(*) FROM exercise_stressors s WHERE s.exercise_id = e2.id AND s.area IN (<avoid placeholders>)) > 0,
         ABS(COALESCE(e2.tier, 2) - ?), e2.name
```

  When `avoid` is empty, use `ORDER BY ABS(COALESCE(e2.tier, 2) - ?), e2.name` (don't emit
  `IN ()`). Append the avoid args before the tier arg.

- Both routes: parse `avoid` like `equipmentTiers` and keep only `isJointArea` values; pass
  it through. Add it to the OpenAPI parameters.
- Composables take a third `avoid: MaybeRefOrGetter<JointArea[]>` (default `[]`), send
  `avoid: toValue(avoid).join(',')`, and include it in the query key
  (`exerciseFallbacks(id, tiers, avoid)`, `exerciseAlternatives(id, tiers, avoid)`).

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server && npx nuxi typecheck`
Expected: PASS. Fix fixtures that build `Exercise` literals by adding `stressors: []`.

**Step 5: Commit**

```bash
git add shared/types/exercise.types.ts server/repositories/exercise.repository.ts "server/api/exercises/[id]" app/composables tests/server/repositories/exercise.repository.test.ts
git commit -m "feat(exercises): expose stressors and rank swaps that avoid flagged areas first"
```

---

### Task 5: User limitations: repository, profile, onboarding, API

**Files:**
- Create: `server/repositories/user-limitation.repository.ts`
- Create: `tests/server/repositories/user-limitation.repository.test.ts`
- Create: `server/api/profile/limitations.post.ts`
- Modify: `server/services/profile.service.ts` (`getProfile`, `completeOnboarding`, `setLimitations`)
- Modify: `server/api/profile/index.get.ts`, `server/api/profile/onboarding.post.ts` (construct with the repo)
- Modify: `shared/schemas/onboarding.ts` (step 5 gains optional `limitations`)
- Test: `tests/server/services/profile.service.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/server/repositories/user-limitation.repository.test.ts
import { describe, expect, it } from 'vitest'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { UserLimitationRepository } from '~~/server/repositories/user-limitation.repository'

describe('UserLimitationRepository', () => {
  it('replaces the whole set and reads it back in canonical order', async () => {
    const db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const repo = new UserLimitationRepository(db)

    await repo.replace('user-1', ['wrist', 'knee'])
    expect(await repo.findForUser('user-1')).toEqual(['knee', 'wrist'])

    await repo.replace('user-1', ['shoulder'])
    expect(await repo.findForUser('user-1')).toEqual(['shoulder'])

    await repo.replace('user-1', [])
    expect(await repo.findForUser('user-1')).toEqual([])
  })
})
```

`profile.service.test.ts`: add a case that `setLimitations(['knee', 'bogus' as never])`
rejects with a 400 and `setLimitations(['knee'])` then `getProfile()` includes
`limitations: ['knee']`. Follow the file's existing service construction, adding
`new UserLimitationRepository(db)` as the new last constructor argument.

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/user-limitation.repository.test.ts tests/server/services/profile.service.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
// server/repositories/user-limitation.repository.ts
import type { Client } from '@libsql/client'
import { JOINT_AREAS, type JointArea } from '~~/shared/lib/joint-areas'

export class UserLimitationRepository {
  constructor(private db: Client) {}

  async findForUser(userId: string): Promise<JointArea[]> {
    const result = await this.db.execute({ sql: 'SELECT area FROM user_limitations WHERE user_id = ?', args: [userId] })
    const areas = new Set(result.rows.map(row => row.area as string))
    return JOINT_AREAS.filter(area => areas.has(area))
  }

  async replace(userId: string, areas: JointArea[]): Promise<void> {
    await this.db.batch([
      { sql: 'DELETE FROM user_limitations WHERE user_id = ?', args: [userId] },
      ...areas.map(area => ({ sql: 'INSERT INTO user_limitations (user_id, area) VALUES (?, ?)', args: [userId, area] })),
    ], 'write')
  }
}
```

`ProfileService`:
- Constructor gains a trailing `private limitations: UserLimitationRepository`. Update every
  `new ProfileService(` (`grep -rn "new ProfileService" server tests`), including the
  adaptive-TDEE route if that plan has landed.
- `getProfile` returns `{ ...profile, displayName, targets, limitations: await this.limitations.findForUser(this.ctx.userId) }`.
- New:

```ts
  async setLimitations(areas: unknown[]): Promise<JointArea[]> {
    if (!areas.every(isJointArea)) throw createError({ statusCode: 400, statusMessage: 'Unknown limitation area' })
    const unique = [...new Set(areas)]
    await this.limitations.replace(this.ctx.userId, unique)
    return this.limitations.findForUser(this.ctx.userId)
  }
```

- `CompleteOnboardingInput` gains `limitations?: JointArea[]`; at the end of
  `completeOnboarding`: `if (input.limitations?.length) await this.setLimitations(input.limitations)`.

Route `server/api/profile/limitations.post.ts`: body `{ limitations: string[] }` →
`{ limitations: await service.setLimitations(body.limitations ?? []) }`, with OpenAPI meta
(400 for unknown areas).

`shared/schemas/onboarding.ts`: `baseOnboardingSchema` gains
`limitations: z.array(z.enum(JOINT_AREAS)).default([])`, and step 5 picks it:
`baseOnboardingSchema.pick({ equipment: true, frequency: true, limitations: true })`.

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server && npx nuxi typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/repositories/user-limitation.repository.ts server/services/profile.service.ts server/api/profile shared/schemas/onboarding.ts tests/server
git commit -m "feat(profile): store joint limitations, settable at onboarding and from profile"
```

---

### Task 6: Preset recommendation penalty

**Files:**
- Modify: `server/repositories/preset-split.repository.ts` (`countStressedTier1Exercises`)
- Modify: `server/services/preset-split.service.ts`
- Modify: `shared/types/preset.types.ts` (`RecommendationInput.limitations?`)
- Modify: `server/api/preset-splits/recommend.get.ts`
- Test: `tests/server/services/preset-split.service.test.ts`

**Step 1: Write the failing test** (in the existing describe; its `beforeEach` seeds presets.
Read which exercises "Full Body" contains.)

```ts
  it('penalises presets by tier-1 exercises that load a limited area, with a reason', async () => {
    // Tag one of Full Body's exercises as a tier-1 shoulder stressor.
    const exerciseId = (await db.execute(`SELECT pse.exercise_id FROM preset_split_exercises pse
      JOIN preset_split_days psd ON psd.id = pse.preset_split_day_id
      JOIN preset_splits ps ON ps.id = psd.preset_split_id WHERE ps.name = 'Full Body' LIMIT 1`)).rows[0]!.exercise_id as string
    await db.execute({ sql: 'UPDATE exercises SET tier = 1 WHERE id = ?', args: [exerciseId] })
    await db.execute({ sql: `INSERT INTO exercise_stressors (exercise_id, area, source) VALUES (?, 'shoulder', 'rule')`, args: [exerciseId] })

    const input = { daysPerWeek: 3, experienceLevel: null, goal: null, equipment: null }
    const before = (await service.recommend(input)).find(r => r.preset.name === 'Full Body')!
    const after = (await service.recommend({ ...input, limitations: ['shoulder'] })).find(r => r.preset.name === 'Full Body')!

    expect(after.score).toBe(before.score - 1)
    expect(after.reasons.join(' ')).toMatch(/1 exercise loads your shoulder/)
  })
```

(If the fixture presets have no exercises, insert a `preset_split_exercises` row for Full
Body's first day in the test first.)

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/services/preset-split.service.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
  // Per published preset: how many distinct tier-1 exercises load at least one of `areas`, and
  // which areas. Main lifts only, since accessories are cheap to swap and shouldn't sink a preset.
  async countStressedTier1Exercises(areas: JointArea[]): Promise<Map<number, { count: number, areas: JointArea[] }>> {
    if (areas.length === 0) return new Map()
    const placeholders = areas.map(() => '?').join(', ')
    const result = await this.db.execute({
      sql: `SELECT psd.preset_split_id AS preset_id, COUNT(DISTINCT pse.exercise_id) AS n, GROUP_CONCAT(DISTINCT s.area) AS areas
            FROM preset_split_exercises pse
            JOIN preset_split_days psd ON psd.id = pse.preset_split_day_id
            JOIN exercises e ON e.id = pse.exercise_id AND e.tier = 1
            JOIN exercise_stressors s ON s.exercise_id = e.id AND s.area IN (${placeholders})
            GROUP BY psd.preset_split_id`,
      args: areas,
    })
    return new Map(result.rows.map(row => [row.preset_id as number, {
      count: row.n as number,
      areas: JOINT_AREAS.filter(a => (row.areas as string).split(',').includes(a)),
    }]))
  }
```

`PresetSplitService.recommend`:

```ts
  async recommend(input: RecommendationInput): Promise<SplitRecommendation[]> {
    const [published, stressed] = await Promise.all([
      this.presets.findPublished(),
      this.presets.countStressedTier1Exercises(input.limitations ?? []),
    ])
    return published
      .map((preset) => {
        const { score, reasons } = scorePreset(preset, input)
        const conflict = stressed.get(preset.id)
        if (!conflict) return { preset, score, reasons }
        const areaLabel = conflict.areas.map(a => JOINT_AREA_LABELS[a].toLowerCase()).join(' and ')
        return {
          preset,
          score: score - conflict.count,
          reasons: [...reasons, `${conflict.count} exercise${conflict.count === 1 ? ' loads' : 's load'} your ${areaLabel}`],
        }
      })
      .filter(({ preset }) => frequencyScore(input.daysPerWeek, preset.frequencyMinDays, preset.frequencyMaxDays) > 0)
      .sort((a, b) => b.score - a.score)
  }
```

`recommend.get.ts`: load limitations with `new UserLimitationRepository(db).findForUser(ctx.userId)`
and pass `limitations`.

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/services/preset-split.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/repositories/preset-split.repository.ts server/services/preset-split.service.ts shared/types/preset.types.ts server/api/preset-splits/recommend.get.ts tests/server/services/preset-split.service.test.ts
git commit -m "feat(presets): soft-penalise presets whose main lifts load a limited joint"
```

---

### Task 7: UI

**Files:**
- Create: `app/components/exercise/LimitationBadge.vue`
- Create: `app/components/profile/LimitationChips.vue`
- Create: `app/composables/useSetLimitations.ts`
- Modify: `app/components/onboarding/FifthStep.vue`, `app/components/onboarding/OnboardingForm.vue` (submit payload)
- Modify: `app/pages/profile.vue`
- Modify: `app/components/builder/DayExercisePicker.vue`, `ExerciseSwapSheet.vue`, `PresetReview.vue`
- Modify: `app/pages/workouts/session/[id].vue`

**Step 1: Composable**

```ts
// app/composables/useSetLimitations.ts
import { useMutation, useQueryCache } from '@pinia/colada'
import type { JointArea } from '~~/shared/lib/joint-areas'

export const useSetLimitations = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()
  return useMutation({
    mutation: (limitations: JointArea[]) => $api<{ limitations: JointArea[] }>('/api/profile/limitations', { method: 'POST', body: { limitations } }),
    onSuccess: () => Promise.all([
      queryCache.invalidateQueries({ key: queryKeys.profile() }),
      queryCache.invalidateQueries({ key: queryKeys.presetSplits() }),
    ]),
  })
}
```

**Step 2: Badge.** It reads the profile itself, so call sites only pass the exercise's stressors:

```vue
<script setup lang="ts">
import { TriangleAlertIcon } from "@lucide/vue";
import { conflictingAreas, JOINT_AREA_LABELS, type JointArea } from "~~/shared/lib/joint-areas";

const props = defineProps<{ stressors: JointArea[] | undefined }>();
const { data: profile } = useProfile();
const conflicts = computed(() => conflictingAreas(props.stressors ?? [], profile.value?.profile?.limitations ?? []));
</script>

<template>
  <UiBadge
    v-if="conflicts.length"
    class="shrink-0 gap-1 rounded-full bg-amber-500/15 px-1.5 py-0 text-[10px] font-medium text-amber-600 dark:text-amber-400"
    :title="`Commonly loads your ${conflicts.map(a => JOINT_AREA_LABELS[a].toLowerCase()).join(' and ')}`"
  >
    <TriangleAlertIcon class="size-3" />
    {{ conflicts.map(a => JOINT_AREA_LABELS[a]).join(" · ") }}
  </UiBadge>
</template>
```

(Check the `useProfile` response path. `profile.value?.profile?.limitations` matches
`GET /api/profile` returning `{ profile, stats }`.)

**Step 3: Chips** (shared by onboarding and profile)

```vue
<script setup lang="ts">
import { JOINT_AREAS, JOINT_AREA_LABELS, type JointArea } from "~~/shared/lib/joint-areas";

const model = defineModel<JointArea[]>({ required: true });
const toggle = (area: JointArea) => {
  model.value = model.value.includes(area) ? model.value.filter(a => a !== area) : [...model.value, area];
};
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap gap-2">
      <button
        v-for="area in JOINT_AREAS"
        :key="area"
        type="button"
        :aria-pressed="model.includes(area)"
        class="rounded-full border px-3 py-1.5 text-sm"
        :class="model.includes(area) ? 'border-foreground bg-foreground text-background' : 'border-surface-strong text-muted-foreground'"
        @click="toggle(area)"
      >
        {{ JOINT_AREA_LABELS[area] }}
      </button>
    </div>
    <p class="text-xs text-muted-foreground">Hadeed flags exercises that commonly load these areas. It isn't medical advice.</p>
  </div>
</template>
```

**Step 4: Onboarding step 5.** Add `limitations: store.form.limitations ?? []` to the form
defaults, and below the equipment group:

```vue
<h2 class="flex gap-x-2 mt-4 pt-4 items-center font-mono text-muted-foreground text-2xl">Anything to work around?</h2>
<p class="text-sm text-muted-foreground">Optional. Skip if nothing bothers you.</p>
<ProfileLimitationChips v-model="form.limitations" />
```

In `OnboardingForm.vue`'s `completeOnboarding({ … })` call, pass `limitations: store.form.limitations ?? []`. The submit body builds its fields one by one, so `limitations` must be added there explicitly. The schema field is `.optional()` (see Task 5), so seed it as `store.form.limitations ?? []` in `FifthStep.vue`. Also add `limitations: JointArea[]` to `CompletedOnboardingProfile` in `app/composables/useCompleteOnboarding.ts`.
Add `limitations` to the onboarding store's form type if it's typed separately.

**Step 5: Profile.** Add a "Limitations" card with `<ProfileLimitationChips v-model="limitationsDraft" />`,
initialised from `profile.limitations` in the same `watch` that seeds the other preference
drafts, and a Save button calling `useSetLimitations().mutateAsync(limitationsDraft.value)`.

**Step 6: Badges**
- `DayExercisePicker.vue`: next to each picked exercise's name and each search result's
  name: `<ExerciseLimitationBadge :stressors="exercise.stressors" />`. For picked rows that
  only hold an id, read stressors from the resolved exercise the component already uses for
  names/images via `useExerciseCatalogCache`.
- `ExerciseSwapSheet.vue`: badge on each alternative, and pass `avoid` (the profile's
  limitations) as the new third argument to `useExerciseAlternatives`.
- `PresetReview.vue`:
  - Keep `exercisesById` resolution and store `stressors` on each `ReviewExercise`
    (`stressors: JointArea[]`, patched in the same watch that patches names, defaulting to `[]`: an `Exercise` cached from before this deploy has no `stressors` field).
  - Show the badge per row.
  - Above the day list:

```vue
<Button v-if="flaggedRows.length" variant="secondary" class="w-full" :disabled="swappingAll" @click="swapAllFlagged">
  Swap {{ flaggedRows.length }} flagged exercise{{ flaggedRows.length === 1 ? "" : "s" }}
</Button>
<p v-if="unswappable.length" class="text-xs text-muted-foreground">
  No clean alternative for {{ unswappable.join(", ") }}. Kept as-is.
</p>
```

```ts
const limitations = computed(() => profile.value?.profile?.limitations ?? []);
const flaggedRows = computed(() => reviewDays.value.flatMap(day =>
  day.exercises.filter(e => conflictingAreas(e.stressors ?? [], limitations.value).length > 0).map(e => ({ day, exercise: e }))));
const swappingAll = ref(false);
const unswappable = ref<string[]>([]);
const { $api } = useNuxtApp();

const swapAllFlagged = async () => {
  swappingAll.value = true;
  unswappable.value = [];
  try {
    for (const { day, exercise } of flaggedRows.value) {
      const candidates = await $api<Exercise[]>(`/api/exercises/${exercise.exerciseId}/fallbacks`, {
        query: { equipmentTiers: equipmentTiers.value.join(","), avoid: limitations.value.join(",") },
      });
      const clean = candidates.find(c => conflictingAreas(c.stressors ?? [], limitations.value).length === 0);
      if (!clean) {
        unswappable.value.push(exercise.name);
        continue;
      }
      exerciseCatalogCache.value.set(clean.id, clean);
      applySwap(day.dayIndex, exercise.position, clean); // the component's existing single-swap handler
    }
  } finally {
    swappingAll.value = false;
  }
};
```

  (Use the component's actual single-swap function name. It's what the swap sheet's `select`
  event calls. If it takes different arguments, adapt the call rather than duplicating its
  body.)
- Session page: `<ExerciseLimitationBadge :stressors="sessionExerciseDetails?.find(d => d.id === exercise.exerciseId)?.stressors" />`
  beside the exercise name (the page already loads `useExercisesByIds`).

**Step 7: Verify manually** (`npm run dev`, after `npm run db:classify-exercises` on the dev DB):
1. Onboarding: step 5 shows the chips and the disclaimer; picking Shoulder and finishing saves it (visible on Profile).
2. Profile: toggling and saving persists across reloads.
3. Builder: search "press". Overhead presses show "⚠ Shoulder". Opening the swap sheet on one lists non-flagged alternatives first.
4. Preset review for a preset containing an overhead press: "Swap 1 flagged exercise" replaces it; the badge disappears; Continue creates the split with the swapped exercise.
5. The recommendation list shows "1 exercise loads your shoulder" on affected presets.
6. Session page shows badges on flagged exercises.
7. With no limitations set, no badges appear anywhere.

**Step 8: Commit**

```bash
git add app/components/exercise/LimitationBadge.vue app/components/profile/LimitationChips.vue app/composables/useSetLimitations.ts app/components/onboarding app/pages/profile.vue app/components/builder "app/pages/workouts/session/[id].vue"
git commit -m "feat(limitations): pick joint limitations and flag, swap and rank exercises around them"
```

---

### Task 8: Final verification

1. `npx vitest run`: all pass.
2. `npx nuxi typecheck` / `npx eslint .`: clean.
3. README:
   - under **Training splits**, add "**Joint limitations**: flag exercises that commonly load a chosen knee, shoulder, lower back, wrist, elbow or ankle; swaps rank clean alternatives first, and preset review can swap all flagged lifts at once."
   - under Scripts, note that `db:classify-exercises` also writes stressor tags.
4. `git add README.md && git commit -m "docs: describe joint limitations"`.
5. Deploy order: `npm run db:seed` (schema) → `npm run db:classify-exercises` → deploy.
