# Onboarding/profile backend completion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the six backend gaps standing between the current `user_profiles`/`body_metrics`
layer and a schema the real onboarding steps can actually submit to: a write path for
`users.display_name`, `Gender` widened to include `'other'`, training-frequency and
equipment-preference fields, a unit-system preference with server-side imperial conversion, and a
timezone field (capture/persist only).

**Architecture:** Four new nullable/defaulted columns on `user_profiles` (`training_days_per_week`,
`equipment`, `unit_system`, `timezone`), no schema change needed for `display_name` (already
exists, just unused) or `gender` (DB CHECK already allows `'other'`). A new minimal
`UserRepository` handles the one `users` table write. `ProfileService.completeOnboarding` grows to
accept and persist all of it; imperial→metric conversion happens in the API route layer via new
pure functions in `shared/lib/formulas.ts`, so the service's contract stays "always canonical
metric in." `GET /api/preset-splits/recommend` falls back to the stored profile for any omitted
query param.

**Tech Stack:** Nuxt 4 Nitro server routes, Turso/libSQL (`@libsql/client`), Vitest, TypeScript.

**Design doc:** `docs/plans/2026-08-23-onboarding-profile-backend-design.md`

---

### Task 1: Schema — four new columns on `user_profiles`

**Files:**
- Modify: `server/database/schema.sql`
- Test: `tests/server/repositories/profile.repository.test.ts` (extended in Task 3, not this task —
  this task just proves the columns exist and the schema still applies cleanly)

**Step 1: Write the failing test**

Add to `tests/server/repositories/profile.repository.test.ts` (this file already exists; add this
`it` inside the existing `describe('ProfileRepository', ...)` block, right after the first test):

```ts
  it('accepts the four new profile columns via a raw insert (schema exists)', async () => {
    await db.execute({
      sql: `UPDATE user_profiles SET training_days_per_week = ?, equipment = ?, unit_system = ?, timezone = ?
            WHERE user_id = ?`,
      args: [4, 'gym', 'imperial', 'America/New_York', 'user-1'],
    })
    // The insert above requires a profile row to already exist; create one first via upsert,
    // then apply the UPDATE, then read the raw row back to confirm the columns are real.
  })
```

Actually — write it as a standalone raw-SQL round-trip instead, since there's no profile row yet
at this point in `beforeEach`. Replace the test above with:

```ts
  it('has the four new profile columns in the schema', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180 })
    await db.execute({
      sql: `UPDATE user_profiles SET training_days_per_week = ?, equipment = ?, unit_system = ?, timezone = ?
            WHERE user_id = ?`,
      args: [4, 'gym', 'imperial', 'America/New_York', 'user-1'],
    })
    const result = await db.execute({ sql: 'SELECT * FROM user_profiles WHERE user_id = ?', args: ['user-1'] })
    const row = result.rows[0] as unknown as Record<string, unknown>
    expect(row.training_days_per_week).toBe(4)
    expect(row.equipment).toBe('gym')
    expect(row.unit_system).toBe('imperial')
    expect(row.timezone).toBe('America/New_York')
  })
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/profile.repository.test.ts`
Expected: FAIL — `SQLITE_ERROR: no such column: training_days_per_week` (or similar).

**Step 3: Add the columns**

In `server/database/schema.sql`, find the `user_profiles` table definition (currently ends at the
`updated_at` column, right before the `body_metrics` table). Immediately after the
`CREATE TABLE IF NOT EXISTS user_profiles (...)` statement, add:

```sql
ALTER TABLE user_profiles ADD COLUMN training_days_per_week INTEGER;
ALTER TABLE user_profiles ADD COLUMN equipment TEXT CHECK (equipment IN ('gym','home','both'));
ALTER TABLE user_profiles ADD COLUMN unit_system TEXT NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial'));
ALTER TABLE user_profiles ADD COLUMN timezone TEXT;
```

No changes needed in `server/utils/test/create-test-db.ts` or `server/database/seed.ts` — both
already wrap every schema statement in a try/catch that swallows "duplicate column name" errors
generically (added for exactly this situation in the prior branch), so these four new
`ALTER TABLE` statements are automatically idempotent against re-runs on a live DB.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/profile.repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/database/schema.sql tests/server/repositories/profile.repository.test.ts
git commit -m "feat: add training frequency, equipment, unit system, and timezone columns to user_profiles"
```

---

### Task 2: Shared types — widen `Gender`, add unit-conversion functions

**Files:**
- Modify: `shared/lib/formulas.ts`
- Test: `tests/shared/lib/formulas.test.ts` (check if this file exists first — if not, create it)

**Step 1: Write the failing test**

First check for an existing formulas test file:
```bash
find tests -iname "formulas*"
```

If none exists, create `tests/shared/lib/formulas.test.ts`. Add (alongside any existing tests if
the file already exists):

```ts
import { describe, it, expect } from 'vitest'
import { cmToIn, inToCm, kgToLbs, lbsToKg, bmrFor_TEST_ONLY_DO_NOT_ADD, tdee } from '~~/shared/lib/formulas'

describe('unit conversion', () => {
  it('round-trips cm/in and kg/lbs within floating-point tolerance', () => {
    expect(cmToIn(180)).toBeCloseTo(70.8661, 3)
    expect(inToCm(70.8661)).toBeCloseTo(180, 2)
    expect(kgToLbs(80)).toBeCloseTo(176.37, 1)
    expect(lbsToKg(176.37)).toBeCloseTo(80, 1)
  })
})

describe('tdee with gender: other', () => {
  it('accepts other and returns the midpoint of the male/female BMR offsets', () => {
    const male = tdee({ weightKg: 75, heightCm: 178, age: 30, gender: 'male', activityLevel: 'sedentary' })
    const female = tdee({ weightKg: 75, heightCm: 178, age: 30, gender: 'female', activityLevel: 'sedentary' })
    const other = tdee({ weightKg: 75, heightCm: 178, age: 30, gender: 'other', activityLevel: 'sedentary' })
    expect(other).toBeGreaterThan(female)
    expect(other).toBeLessThan(male)
  })
})
```

Remove the bogus `bmrFor_TEST_ONLY_DO_NOT_ADD` import before running — that was a placeholder to
remind you `bmrFor` is not exported (it's a private module function); the `tdee`-based test above
is the real one and doesn't need it. The final test file should only import `cmToIn`, `inToCm`,
`kgToLbs`, `lbsToKg`, `tdee`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/lib/formulas.test.ts`
Expected: FAIL — `cmToIn is not a function` (or a TS error if new, since none of these exist yet),
and the `gender: 'other'` test fails to typecheck/compile since `Gender` doesn't include `'other'`
yet.

**Step 3: Implement**

In `shared/lib/formulas.ts`, widen the type and add the four conversion functions:

```ts
export type Gender = 'male' | 'female' | 'other'
```

Add near `bmi`/`tdee` (after `bmi`, before `bmrFor`):

```ts
export function cmToIn(cm: number): number {
  return cm / 2.54
}

export function inToCm(inches: number): number {
  return inches * 2.54
}

export function kgToLbs(kg: number): number {
  return kg * 2.20462262185
}

export function lbsToKg(lbs: number): number {
  return lbs / 2.20462262185
}
```

No change needed to `bmrFor` itself — its `'other'` fallback branch (`base + (5 + -161) / 2`)
already exists and was simply unreachable through the narrower type until now.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/lib/formulas.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add shared/lib/formulas.ts tests/shared/lib/formulas.test.ts
git commit -m "feat: widen Gender to include other, add cm/in and kg/lbs conversion functions"
```

---

### Task 3: `UserProfile` type — expose the four new fields

**Files:**
- Modify: `shared/types/profile.types.ts`

**Step 1: No new test for this task alone**

This is a pure type change with no runtime behavior — Task 4 (`ProfileRepository`) is what
actually proves these fields round-trip, via its own failing test. Making this its own task keeps
each commit small or, if the you-implementing-this prefers, fold this directly into Task 4's
implementation step. Either is fine; shown separately here for clarity of what changes.

**Step 2: Implement**

In `shared/types/profile.types.ts`, add the import and extend `UserProfile`:

```ts
import type { ActivityLevel, Gender } from '~~/shared/lib/formulas'
import type { Equipment } from '~~/shared/types/preset.types'

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'
export type Goal = 'fat_loss' | 'muscle_gain' | 'maintenance' | 'general_fitness'
export type MetricSource = 'manual' | 'inbody' | 'wearable'
export type UnitSystem = 'metric' | 'imperial'

export interface UserProfile {
  userId: string
  dateOfBirth: string
  gender: Gender
  heightCm: number
  activityLevel: ActivityLevel | null
  experienceLevel: ExperienceLevel | null
  primaryGoal: Goal | null
  trainingDaysPerWeek: number | null
  equipment: Equipment | null
  unitSystem: UnitSystem
  timezone: string | null
  updatedAt: string
}
```

**Step 3: Commit alongside Task 4** (don't commit this in isolation — it'll fail typecheck on its
own since `ProfileRepository.mapRow` won't populate the new fields yet. Proceed straight to Task 4
and commit both together.)

---

### Task 4: `ProfileRepository` — persist and read the four new fields

**Files:**
- Modify: `server/repositories/profile.repository.ts`
- Test: `tests/server/repositories/profile.repository.test.ts`

**Step 1: Write the failing test**

Add to `tests/server/repositories/profile.repository.test.ts`:

```ts
  it('upserts and reads back trainingDaysPerWeek, equipment, unitSystem, and timezone', async () => {
    await repo.upsert('user-1', {
      dateOfBirth: '1995-01-01',
      gender: 'male',
      heightCm: 180,
      trainingDaysPerWeek: 4,
      equipment: 'gym',
      unitSystem: 'imperial',
      timezone: 'America/New_York',
    })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.trainingDaysPerWeek).toBe(4)
    expect(profile?.equipment).toBe('gym')
    expect(profile?.unitSystem).toBe('imperial')
    expect(profile?.timezone).toBe('America/New_York')
  })

  it('defaults unitSystem to metric and leaves the other three null when omitted', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180 })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.unitSystem).toBe('metric')
    expect(profile?.trainingDaysPerWeek).toBeNull()
    expect(profile?.equipment).toBeNull()
    expect(profile?.timezone).toBeNull()
  })
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/profile.repository.test.ts`
Expected: FAIL — `profile?.trainingDaysPerWeek` is `undefined`, not `4` (the repository doesn't
read/write these columns yet).

**Step 3: Implement**

In `server/repositories/profile.repository.ts`, apply the Task 3 type change (if not already
done) plus:

```ts
import type { Client } from '@libsql/client'
import type { ActivityLevel, Gender } from '~~/shared/lib/formulas'
import type { Equipment } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal, UnitSystem, UserProfile } from '~~/shared/types/profile.types'

export interface UpsertProfileInput {
  dateOfBirth: string
  gender: Gender
  heightCm: number
  activityLevel?: ActivityLevel | null
  experienceLevel?: ExperienceLevel | null
  primaryGoal?: Goal | null
  trainingDaysPerWeek?: number | null
  equipment?: Equipment | null
  unitSystem?: UnitSystem
  timezone?: string | null
}

export class ProfileRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): UserProfile {
    return {
      userId: row.user_id as string,
      dateOfBirth: row.date_of_birth as string,
      gender: row.gender as Gender,
      heightCm: row.height_cm as number,
      activityLevel: row.activity_level as ActivityLevel | null,
      experienceLevel: row.experience_level as ExperienceLevel | null,
      primaryGoal: row.primary_goal as Goal | null,
      trainingDaysPerWeek: row.training_days_per_week as number | null,
      equipment: row.equipment as Equipment | null,
      unitSystem: row.unit_system as UnitSystem,
      timezone: row.timezone as string | null,
      updatedAt: row.updated_at as string,
    }
  }

  async findByUserId(userId: string): Promise<UserProfile | null> {
    const result = await this.db.execute({ sql: 'SELECT * FROM user_profiles WHERE user_id = ?', args: [userId] })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async upsert(userId: string, input: UpsertProfileInput): Promise<UserProfile> {
    const result = await this.db.execute({
      sql: `INSERT INTO user_profiles
              (user_id, date_of_birth, gender, height_cm, activity_level, experience_level, primary_goal,
               training_days_per_week, equipment, unit_system, timezone, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'metric'), ?, datetime('now'))
            ON CONFLICT (user_id) DO UPDATE SET
              date_of_birth = excluded.date_of_birth,
              gender = excluded.gender,
              height_cm = excluded.height_cm,
              activity_level = excluded.activity_level,
              experience_level = excluded.experience_level,
              primary_goal = excluded.primary_goal,
              training_days_per_week = excluded.training_days_per_week,
              equipment = excluded.equipment,
              unit_system = excluded.unit_system,
              timezone = excluded.timezone,
              updated_at = datetime('now')
            RETURNING *`,
      args: [
        userId,
        input.dateOfBirth,
        input.gender,
        input.heightCm,
        input.activityLevel ?? null,
        input.experienceLevel ?? null,
        input.primaryGoal ?? null,
        input.trainingDaysPerWeek ?? null,
        input.equipment ?? null,
        input.unitSystem ?? null,
        input.timezone ?? null,
      ],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to upsert profile')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }
}
```

Note the `COALESCE(?, 'metric')` on the `unit_system` column in the `INSERT` values list: the
column itself has a `NOT NULL DEFAULT 'metric'`, but that default only applies when the column is
*omitted* from the `INSERT` entirely — since this statement always supplies a value positionally
(even if it's a bound `NULL`), the column default is bypassed and `NULL` would violate the `NOT
NULL` constraint unless explicitly coalesced here.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/profile.repository.test.ts`
Expected: PASS — including the existing tests from before this task, unmodified.

**Step 5: Commit**

```bash
git add shared/types/profile.types.ts server/repositories/profile.repository.ts tests/server/repositories/profile.repository.test.ts
git commit -m "feat: persist trainingDaysPerWeek, equipment, unitSystem, and timezone on UserProfile"
```

---

### Task 5: New `UserRepository` — `updateDisplayName`

**Files:**
- Create: `server/repositories/user.repository.ts`
- Test: `tests/server/repositories/user.repository.test.ts`

**Step 1: Write the failing test**

Create `tests/server/repositories/user.repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { UserRepository } from '~~/server/repositories/user.repository'

describe('UserRepository.updateDisplayName', () => {
  let db: Client
  let repo: UserRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new UserRepository(db)
  })

  it('sets the display name for an existing user', async () => {
    await repo.updateDisplayName('user-1', 'Jordan')

    const result = await db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: ['user-1'] })
    expect(result.rows[0]?.display_name).toBe('Jordan')
  })

  it('is a no-op for a user id that does not exist, rather than throwing', async () => {
    await expect(repo.updateDisplayName('nonexistent', 'Nobody')).resolves.not.toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/user.repository.test.ts`
Expected: FAIL — `Cannot find module '~~/server/repositories/user.repository'`.

**Step 3: Implement**

Create `server/repositories/user.repository.ts`:

```ts
import type { Client } from '@libsql/client'

export class UserRepository {
  constructor(private db: Client) {}

  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    await this.db.execute({
      sql: 'UPDATE users SET display_name = ? WHERE id = ?',
      args: [displayName, userId],
    })
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/user.repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/repositories/user.repository.ts tests/server/repositories/user.repository.test.ts
git commit -m "feat: add UserRepository.updateDisplayName"
```

---

### Task 6: `ProfileService.completeOnboarding` — wire everything through

**Files:**
- Modify: `server/services/profile.service.ts`
- Test: `tests/server/services/profile.service.test.ts`

**Step 1: Write the failing test**

Add to `tests/server/services/profile.service.test.ts` (update the `beforeEach` and add new
`it` blocks):

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { ProfileService } from '~~/server/services/profile.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

describe('ProfileService', () => {
  let db: Client
  let service: ProfileService
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db))
  })

  // ...(existing tests unchanged)...

  it('persists displayName, trainingDaysPerWeek, equipment, unitSystem, and timezone when provided', async () => {
    await service.completeOnboarding({
      displayName: 'Jordan',
      dateOfBirth: '1995-06-15',
      gender: 'other',
      heightCm: 178,
      weightKg: 75,
      trainingDaysPerWeek: 4,
      equipment: 'home',
      unitSystem: 'imperial',
      timezone: 'America/New_York',
    })

    const profile = await service.getProfile()
    expect(profile?.gender).toBe('other')
    expect(profile?.trainingDaysPerWeek).toBe(4)
    expect(profile?.equipment).toBe('home')
    expect(profile?.unitSystem).toBe('imperial')
    expect(profile?.timezone).toBe('America/New_York')

    const userRow = await db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: ['user-1'] })
    expect(userRow.rows[0]?.display_name).toBe('Jordan')
  })

  it('does not touch display_name when displayName is omitted', async () => {
    await service.completeOnboarding({ dateOfBirth: '1995-06-15', gender: 'male', heightCm: 178, weightKg: 75 })

    const userRow = await db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: ['user-1'] })
    expect(userRow.rows[0]?.display_name).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/services/profile.service.test.ts`
Expected: FAIL — constructor signature mismatch (`ProfileService` doesn't accept a fourth
`UserRepository` argument yet), and `gender: 'other'` widening not yet in effect until Task 2 is
also done (it should already be, if tasks are executed in order).

**Step 3: Implement**

In `server/services/profile.service.ts`:

```ts
import { BaseService } from '~~/server/services/base.service'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import type { UserRepository } from '~~/server/repositories/user.repository'
import { bmi, tdee } from '~~/shared/lib/formulas'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { ActivityLevel, Gender } from '~~/shared/lib/formulas'
import type { Equipment } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal, UnitSystem } from '~~/shared/types/profile.types'

export interface CompleteOnboardingInput {
  displayName?: string
  dateOfBirth: string
  gender: Gender
  heightCm: number
  weightKg: number
  activityLevel?: ActivityLevel
  experienceLevel?: ExperienceLevel
  primaryGoal?: Goal
  trainingDaysPerWeek?: number
  equipment?: Equipment
  unitSystem?: UnitSystem
  timezone?: string
}

function ageFromDob(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth)
  const diffMs = Date.now() - dob.getTime()
  return Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000))
}

export class ProfileService extends BaseService {
  constructor(
    ctx: RequestContext,
    private profiles: ProfileRepository,
    private bodyMetrics: BodyMetricsRepository,
    private users: UserRepository,
  ) {
    super(ctx)
  }

  async completeOnboarding(input: CompleteOnboardingInput): Promise<void> {
    await this.profiles.upsert(this.ctx.userId, {
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      heightCm: input.heightCm,
      activityLevel: input.activityLevel ?? null,
      experienceLevel: input.experienceLevel ?? null,
      primaryGoal: input.primaryGoal ?? null,
      trainingDaysPerWeek: input.trainingDaysPerWeek ?? null,
      equipment: input.equipment ?? null,
      unitSystem: input.unitSystem,
      timezone: input.timezone ?? null,
    })
    await this.bodyMetrics.record(this.ctx.userId, {
      recordedAt: new Date().toISOString().slice(0, 10),
      weightKg: input.weightKg,
      source: 'manual',
      measurements: [],
    })
    if (input.displayName) {
      await this.users.updateDisplayName(this.ctx.userId, input.displayName)
    }
  }

  getProfile() {
    return this.profiles.findByUserId(this.ctx.userId)
  }

  async getComputedStats(): Promise<{ bmi: number, tdee: number | null } | null> {
    const profile = await this.profiles.findByUserId(this.ctx.userId)
    if (!profile) return null

    const metrics = await this.bodyMetrics.findForUser(this.ctx.userId)
    const latestMetric = metrics[0]
    if (!latestMetric) return null

    const bmiValue = bmi({ weightKg: latestMetric.weightKg, heightCm: profile.heightCm })
    const tdeeValue = profile.activityLevel
      ? tdee({
          weightKg: latestMetric.weightKg,
          heightCm: profile.heightCm,
          age: ageFromDob(profile.dateOfBirth),
          gender: profile.gender,
          activityLevel: profile.activityLevel,
        })
      : null

    return { bmi: bmiValue, tdee: tdeeValue }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/services/profile.service.test.ts`
Expected: PASS

**Step 5: Update the route's constructor call**

`server/api/profile/onboarding.post.ts` constructs `ProfileService` inline and needs the new
`UserRepository` argument:

```ts
import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { ProfileService } from '~~/server/services/profile.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db))
  await service.completeOnboarding(body)
  return service.getProfile()
})
```

This is deliberately still an untyped `readBody(event)` pass-through — Task 7 adds the
imperial-unit-conversion layer here.

**Step 6: Commit**

```bash
git add server/services/profile.service.ts server/api/profile/onboarding.post.ts tests/server/services/profile.service.test.ts
git commit -m "feat: wire displayName, trainingDaysPerWeek, equipment, unitSystem, and timezone into completeOnboarding"
```

---

### Task 7: Onboarding route — accept imperial input, convert server-side

**Files:**
- Modify: `server/api/profile/onboarding.post.ts`

**Step 1: No automated test for this task**

This codebase has no route-level (`server/api/**`) test files anywhere — confirmed by the final
holistic review on the prior branch as an existing project convention, not a gap introduced here.
This task is implementation-only; verify manually per Step 3 below instead of writing a test file
that would break from that convention.

**Step 2: Implement**

Replace `server/api/profile/onboarding.post.ts` with:

```ts
import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { ProfileService, type CompleteOnboardingInput } from '~~/server/services/profile.service'
import { inToCm, lbsToKg } from '~~/shared/lib/formulas'

interface OnboardingRequestBody extends Omit<CompleteOnboardingInput, 'heightCm' | 'weightKg'> {
  height: number // cm if unitSystem is 'metric' (or omitted), inches if 'imperial'
  weight: number // kg if unitSystem is 'metric' (or omitted), lbs if 'imperial'
}

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as OnboardingRequestBody
  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db))

  const isImperial = body.unitSystem === 'imperial'
  const input: CompleteOnboardingInput = {
    ...body,
    heightCm: isImperial ? inToCm(body.height) : body.height,
    weightKg: isImperial ? lbsToKg(body.weight) : body.weight,
  }

  await service.completeOnboarding(input)
  return service.getProfile()
})
```

Note: `...body` spreads `height`/`weight` too, but `CompleteOnboardingInput` doesn't declare
those fields, so they're harmless excess properties at the type level once narrowed by the
object literal's explicit `heightCm`/`weightKg` overrides — TypeScript's structural typing
allows this for a variable already widened to `OnboardingRequestBody`. If your editor flags this,
destructure `height`/`weight` out of `body` explicitly before spreading the rest instead:
`const { height, weight, ...rest } = body` and spread `...rest`.

**Step 3: Manual verification**

Run: `npm run dev` (or the project's existing dev-server command), then:

```bash
curl -X POST http://localhost:3000/api/profile/onboarding \
  -H 'content-type: application/json' \
  -H 'x-user-id: <a real seeded user id>' \
  -d '{"dateOfBirth":"1995-06-15","gender":"other","height":70,"weight":170,"unitSystem":"imperial","trainingDaysPerWeek":4,"equipment":"home","timezone":"America/New_York","displayName":"Jordan"}'
```

Expected: response includes `heightCm` close to `177.8` (70 in × 2.54) and the profile persists
correctly. Confirm via a follow-up `GET` on whatever profile-read endpoint exists, or a direct DB
query.

**Step 4: Commit**

```bash
git add server/api/profile/onboarding.post.ts
git commit -m "feat: accept imperial height/weight in the onboarding route, convert server-side"
```

---

### Task 8: Recommendation route — fall back to the stored profile

**Files:**
- Modify: `server/api/preset-splits/recommend.get.ts`

**Step 1: No automated test for this task** (same route-testing convention as Task 7)

**Step 2: Implement**

In `server/api/preset-splits/recommend.get.ts`, add a profile lookup and use it as the fallback
source for any omitted query param:

```ts
import { createError, getQuery } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import { PresetSplitService } from '~~/server/services/preset-split.service'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { Equipment } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal } from '~~/shared/types/profile.types'

const EXPERIENCE_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced']
const GOALS: Goal[] = ['fat_loss', 'muscle_gain', 'maintenance', 'general_fitness']
const EQUIPMENT_OPTIONS: Equipment[] = ['gym', 'home', 'both']

// ...(defineRouteMeta block unchanged — daysPerWeek's `required: true` in the OpenAPI schema
// becomes slightly inaccurate now that a stored profile can supply it, but OpenAPI has no clean
// way to express "required unless X", so leave the doc as the common case and don't over-engineer
// the spec for this)...

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid ${field}` })
  }
  return value as T
}

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const query = getQuery(event)
  const db = useDb()

  const profile = await new ProfileRepository(db).findByUserId(ctx.userId)

  const rawDaysPerWeek = query.daysPerWeek !== undefined ? Number(query.daysPerWeek) : profile?.trainingDaysPerWeek
  if (rawDaysPerWeek === null || rawDaysPerWeek === undefined || !Number.isFinite(rawDaysPerWeek) || rawDaysPerWeek <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'daysPerWeek must be a positive number (as a query param, or set on your profile)' })
  }

  const service = new PresetSplitService(ctx, new PresetSplitRepository(db))
  return service.recommend({
    daysPerWeek: rawDaysPerWeek,
    experienceLevel: parseEnum(query.experienceLevel, EXPERIENCE_LEVELS, 'experienceLevel') ?? profile?.experienceLevel ?? null,
    goal: parseEnum(query.goal, GOALS, 'goal') ?? profile?.primaryGoal ?? null,
    equipment: parseEnum(query.equipment, EQUIPMENT_OPTIONS, 'equipment') ?? profile?.equipment ?? null,
  })
})
```

An explicit query param always overrides the stored profile value; a query param is only ever
substituted when *entirely omitted* (not when explicitly given, even if it later scores lower —
that's the caller's deliberate override, same as before this change).

**Step 3: Manual verification**

With a seeded profile that has `training_days_per_week`, `experience_level`, `primary_goal`, and
`equipment` set, call `GET /api/preset-splits/recommend` with **no query params at all** and
confirm it no longer 400s and instead scores using the stored profile. Then call it again with an
explicit `?daysPerWeek=2` and confirm that value wins over the stored one.

**Step 4: Commit**

```bash
git add server/api/preset-splits/recommend.get.ts
git commit -m "feat: fall back to the stored profile for omitted recommend query params"
```

---

### Task 9: Full-suite verification

**Files:** none (verification only)

**Step 1:** Run the entire test suite:
```bash
npx vitest run
```
Expected: all tests pass, including every test from Tasks 1–6.

**Step 2:** Typecheck:
```bash
npx nuxi typecheck
```
Expected: no new errors introduced by this plan (the codebase has one pre-existing unrelated
error in `server/database/seed.ts:55` from before this plan — confirm nothing new appears
alongside it).

**Step 3:** Lint:
```bash
npx eslint server/repositories/user.repository.ts server/repositories/profile.repository.ts \
  server/services/profile.service.ts server/api/profile/onboarding.post.ts \
  server/api/preset-splits/recommend.get.ts shared/lib/formulas.ts shared/types/profile.types.ts \
  tests/server/repositories/user.repository.test.ts tests/server/repositories/profile.repository.test.ts \
  tests/server/services/profile.service.test.ts tests/shared/lib/formulas.test.ts
```
Expected: clean.

**Step 4:** No commit for this task — it's pure verification. If anything fails, fix it as part
of whichever task's commit it belongs to (amend forward with a new commit, not `--amend`, per
this project's git conventions), then re-run this task.
