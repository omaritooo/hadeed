# Splits, Presets, Profile/Targets, and Gamification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a repository/service layer (with types shared between server and client) for the exercise catalog, user profile/measurements/targets, Program→Block→SplitDay→SplitExercise, admin-managed preset splits with a recommendation engine, guided split creation, and gamification (XP/streaks/achievements) foundations.

**Architecture:** `shared/types/` and `shared/lib/` hold plain types and pure functions auto-imported on both client and server (Nuxt 4 convention). `server/repositories/*` wrap the libSQL client behind a generic `BaseRepository`. `server/services/*` hold business logic on top of repositories, extending `BaseService`, which enforces per-user ownership and role-based permissions in code — the real security boundary, since Turso/libSQL has no row-level security. No git repository exists in this project (declined at planning time), so each task's steps end after verification; there is no commit step.

**Tech Stack:** Nuxt 4, TypeScript, `@libsql/client` (Turso), Vitest (added by this plan), SQLite DDL in `server/database/schema.sql`.

**Context this plan assumes:**
- Design doc: `docs/plans/2026-08-18-splits-presets-gamification-design.md` — read it before starting, it has the full rationale.
- Existing: `server/database/schema.sql` (exercises/muscles catalog), `server/database/seed.ts`, `server/utils/db.ts` (`useDb()`, Nuxt-runtime-only), `gym_exercises.json` (873 exercises).
- Auth is **not** wired up yet (`@nuxtjs/supabase` is a dependency but not a registered Nuxt module). This plan does not add auth. API routes take a `userId` from a request header as a placeholder — every route that does this has a `// TODO(auth)` comment marking it for replacement once real auth exists.
- No test framework is installed yet (Task 1 adds it).

---

## Task 1: Add Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `shared/lib/smoke.test.ts` (deleted at the end of this task, just to prove the runner works)

**Step 1: Install vitest as a dev dependency**

`vitest` is already resolved in `package-lock.json` (transitively, via `@nuxt/test-utils`) at `^4.0.2`, so this should not change other resolved versions.

Run: `npm install -D vitest@^4.0.2`

**Step 2: Add the test script**

In `package.json`, inside `"scripts"`, add:

```json
"test": "vitest run"
```

**Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
```

This is a plain Vitest config, not `@nuxt/test-utils`'s Nuxt environment — every repository/service in this plan takes its `@libsql/client` instance via constructor injection instead of calling `useRuntimeConfig()`, so tests never need a Nuxt runtime.

**Step 4: Write a throwaway smoke test**

`shared/lib/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

**Step 5: Run it**

Run: `npx vitest run`
Expected: 1 passed.

**Step 6: Delete the smoke test**

Run: `rm shared/lib/smoke.test.ts`

---

## Task 2: Shared pure formulas (BMI, TDEE, XP→level)

**Files:**
- Create: `shared/lib/formulas.ts`
- Test: `shared/lib/formulas.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { bmi, tdee, xpToLevel } from './formulas'

describe('bmi', () => {
  it('computes weight_kg / height_m^2', () => {
    expect(bmi({ weightKg: 70, heightCm: 175 })).toBeCloseTo(22.86, 1)
  })
})

describe('tdee', () => {
  it('computes Mifflin-St Jeor for a male, moderately active', () => {
    // BMR = 10*70 + 6.25*175 - 5*30 + 5 = 700 + 1093.75 - 150 + 5 = 1648.75
    // TDEE = BMR * 1.55 (moderately_active)
    const result = tdee({
      weightKg: 70,
      heightCm: 175,
      age: 30,
      gender: 'male',
      activityLevel: 'moderately_active',
    })
    expect(result).toBeCloseTo(1648.75 * 1.55, 0)
  })

  it('computes Mifflin-St Jeor for a female, sedentary', () => {
    // BMR = 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25
    const result = tdee({
      weightKg: 60,
      heightCm: 165,
      age: 25,
      gender: 'female',
      activityLevel: 'sedentary',
    })
    expect(result).toBeCloseTo(1345.25 * 1.2, 0)
  })

  it('averages male/female constants for gender "other"', () => {
    const male = tdee({ weightKg: 70, heightCm: 175, age: 30, gender: 'male', activityLevel: 'sedentary' })
    const female = tdee({ weightKg: 70, heightCm: 175, age: 30, gender: 'female', activityLevel: 'sedentary' })
    const other = tdee({ weightKg: 70, heightCm: 175, age: 30, gender: 'other', activityLevel: 'sedentary' })
    expect(other).toBeCloseTo((male + female) / 2, 5)
  })
})

describe('xpToLevel', () => {
  it('returns level 1 at 0 xp', () => {
    expect(xpToLevel(0)).toBe(1)
  })

  it('increases with more xp', () => {
    expect(xpToLevel(5000)).toBeGreaterThan(xpToLevel(100))
  })

  it('never returns a level below 1', () => {
    expect(xpToLevel(-100)).toBe(1)
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run shared/lib/formulas.test.ts`
Expected: FAIL — `formulas.ts` doesn't exist.

**Step 3: Implement**

```ts
export type Gender = 'male' | 'female' | 'other'
export type ActivityLevel =
  | 'sedentary'
  | 'lightly_active'
  | 'moderately_active'
  | 'very_active'
  | 'extremely_active'

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extremely_active: 1.9,
}

export function bmi(input: { weightKg: number, heightCm: number }): number {
  const heightM = input.heightCm / 100
  return input.weightKg / (heightM * heightM)
}

function bmrFor(gender: Gender, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  if (gender === 'male') return base + 5
  if (gender === 'female') return base - 161
  return base + (5 + -161) / 2
}

export function tdee(input: {
  weightKg: number
  heightCm: number
  age: number
  gender: Gender
  activityLevel: ActivityLevel
}): number {
  const bmr = bmrFor(input.gender, input.weightKg, input.heightCm, input.age)
  return bmr * ACTIVITY_MULTIPLIERS[input.activityLevel]
}

const XP_PER_LEVEL_BASE = 500

export function xpToLevel(xp: number): number {
  const clamped = Math.max(0, xp)
  return Math.floor(Math.sqrt(clamped / XP_PER_LEVEL_BASE)) + 1
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run shared/lib/formulas.test.ts`
Expected: all tests pass.

---

## Task 3: Shared domain types

**Files:**
- Create: `shared/types/exercise.types.ts`
- Create: `shared/types/rbac.types.ts`
- Create: `shared/types/profile.types.ts`
- Create: `shared/types/split.types.ts`
- Create: `shared/types/preset.types.ts`
- Create: `shared/types/gamification.types.ts`

No tests — pure type declarations, nothing to assert. Every field name matches a column from the design doc's schema so repositories can map 1:1.

**`shared/types/exercise.types.ts`:**

```ts
export type MuscleRole = 'primary' | 'secondary'

export interface Muscle {
  id: number
  name: string
}

export interface Exercise {
  id: string
  name: string
  category: string | null
  equipment: string | null
  force: string | null
  level: string | null
  mechanic: string | null
  instructions: string[]
}

export interface ExerciseMuscle {
  exerciseId: string
  muscleId: number
  role: MuscleRole
}
```

**`shared/types/rbac.types.ts`:**

```ts
export interface Role {
  id: number
  key: string
  name: string
  permissions: string[]
}

export interface RequestContext {
  userId: string
  roles: string[]
  permissions: string[]
}
```

**`shared/types/profile.types.ts`:**

```ts
import type { ActivityLevel, Gender } from '../lib/formulas'

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'
export type Goal = 'fat_loss' | 'muscle_gain' | 'maintenance' | 'general_fitness'
export type MetricSource = 'manual' | 'inbody' | 'wearable'

export interface UserProfile {
  userId: string
  dateOfBirth: string
  gender: Gender
  heightCm: number
  activityLevel: ActivityLevel | null
  experienceLevel: ExperienceLevel | null
  primaryGoal: Goal | null
  updatedAt: string
}

export interface BodyMetric {
  id: number
  userId: string
  recordedAt: string
  weightKg: number
  bodyFatPct: number | null
  visceralFat: number | null
  muscleMassKg: number | null
  source: MetricSource
  measurements: BodyMetricMeasurement[]
}

export interface BodyMetricMeasurement {
  id: number
  bodyMetricId: number
  key: string
  valueCm: number
}

export type TargetMetric = 'weight' | 'body_fat_pct' | `measurement:${string}`

export interface UserTarget {
  id: number
  userId: string
  metric: TargetMetric
  targetValue: number
  targetDate: string | null
  startingValue: number
  startingRecordedAt: string
  achievedAt: string | null
  isActive: boolean
}
```

**`shared/types/split.types.ts`:**

```ts
export type DayLocation = 'gym' | 'home'
export type SetType = 'weight_reps' | 'bodyweight_reps' | 'time'

export interface Program {
  id: number
  userId: string
  name: string
}

export interface MacroTarget {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface Block {
  id: number
  programId: number
  userId: string
  name: string
  startDate: string
  endDate: string | null
  trainingDayMacroTarget: MacroTarget | null
  restDayMacroTarget: MacroTarget | null
}

export interface SplitDay {
  id: number
  blockId: number
  name: string
  dayOfWeek: number
  location: DayLocation
}

export interface SplitExercise {
  id: number
  splitDayId: number
  exerciseId: string
  position: number
  setType: SetType
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}
```

**`shared/types/preset.types.ts`:**

```ts
import type { ExperienceLevel, Goal } from './profile.types'
import type { DayLocation, SetType } from './split.types'

export type Equipment = 'gym' | 'home' | 'both'

export interface PresetSplit {
  id: number
  name: string
  description: string | null
  frequencyMinDays: number
  frequencyMaxDays: number
  goal: Goal | null
  experienceLevel: ExperienceLevel | null
  equipment: Equipment
  isPublished: boolean
}

export interface PresetSplitDay {
  id: number
  presetSplitId: number
  name: string
  dayIndex: number
  location: DayLocation
  targetMuscleIds: number[]
}

export interface PresetSplitExercise {
  id: number
  presetSplitDayId: number
  exerciseId: string
  position: number
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}

export interface SplitRecommendation {
  preset: PresetSplit
  score: number
  reasons: string[]
}

export interface RecommendationInput {
  daysPerWeek: number
  experienceLevel: ExperienceLevel | null
  goal: Goal | null
  equipment: Equipment | null
}
```

Note: `SplitExercise`'s `setType` field name is reused conceptually here but `PresetSplitExercise` intentionally has no `setType` — presets recommend an exercise + targets, the concrete `set_type` is resolved from the `Exercise` at clone time (a bodyweight movement stays bodyweight_reps regardless of preset).

**`shared/types/gamification.types.ts`:**

```ts
export type XpSourceType = 'set_logged' | 'session_completed' | 'pr'

export interface XpEvent {
  id: number
  userId: string
  amount: number
  sourceType: XpSourceType
  sourceId: string
  createdAt: string
}

export interface Streak {
  userId: string
  currentStreak: number
  longestStreak: number
  lastActiveDate: string | null
}

export type AchievementCriteriaType = 'session_count' | 'streak_length' | 'pr' | 'target_hit'

export interface Achievement {
  id: number
  key: string
  name: string
  description: string | null
  icon: string | null
  criteriaType: AchievementCriteriaType
  criteriaValue: Record<string, unknown>
  isPublished: boolean
}

export interface UserAchievement {
  userId: string
  achievementId: number
  unlockedAt: string
}
```

---

## Task 4: Extend the database schema

**Files:**
- Modify: `server/database/schema.sql`

**Step 1: Append the new tables**

Append to the end of `server/database/schema.sql` (after the existing `exercise_images` index), preserving the existing file's style (`CREATE TABLE IF NOT EXISTS`, comments above each logical group):

```sql
-- Auth / RBAC. Turso has no row-level security, so user_id scoping and
-- permission checks are enforced in the service layer, not the database.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  permissions  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Profile, body measurements, targets.

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth    TEXT NOT NULL,
  gender           TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  height_cm        REAL NOT NULL,
  activity_level   TEXT CHECK (activity_level IN
                     ('sedentary','lightly_active','moderately_active','very_active','extremely_active')),
  experience_level TEXT CHECK (experience_level IN ('beginner','intermediate','advanced')),
  primary_goal     TEXT CHECK (primary_goal IN ('fat_loss','muscle_gain','maintenance','general_fitness')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS body_metrics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recorded_at    TEXT NOT NULL,
  weight_kg      REAL NOT NULL,
  body_fat_pct   REAL,
  visceral_fat   REAL,
  muscle_mass_kg REAL,
  source         TEXT NOT NULL CHECK (source IN ('manual','inbody','wearable'))
);

CREATE TABLE IF NOT EXISTS body_metric_measurements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  body_metric_id  INTEGER NOT NULL REFERENCES body_metrics(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  value_cm        REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS user_targets (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric                TEXT NOT NULL,
  target_value          REAL NOT NULL,
  target_date           TEXT,
  starting_value        REAL NOT NULL,
  starting_recorded_at  TEXT NOT NULL,
  achieved_at           TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1
);

-- Program -> Block -> SplitDay -> SplitExercise: the user's own, logged-against templates.

CREATE TABLE IF NOT EXISTS programs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id                INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  start_date                TEXT NOT NULL,
  end_date                  TEXT,
  training_day_macro_target TEXT,
  rest_day_macro_target     TEXT
);

CREATE TABLE IF NOT EXISTS split_days (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id     INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  day_of_week  INTEGER NOT NULL,
  location     TEXT NOT NULL CHECK (location IN ('gym','home'))
);

CREATE TABLE IF NOT EXISTS split_exercises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  split_day_id  INTEGER NOT NULL REFERENCES split_days(id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercises(id),
  position      INTEGER NOT NULL,
  set_type      TEXT NOT NULL CHECK (set_type IN ('weight_reps','bodyweight_reps','time')),
  target_sets   INTEGER,
  target_reps   INTEGER,
  target_rpe    REAL
);

-- Preset splits: admin-managed catalog, independent of any user's Block.

CREATE TABLE IF NOT EXISTS preset_splits (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  description         TEXT,
  frequency_min_days  INTEGER NOT NULL,
  frequency_max_days  INTEGER NOT NULL,
  goal                TEXT,
  experience_level    TEXT,
  equipment           TEXT NOT NULL CHECK (equipment IN ('gym','home','both')),
  is_published        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS preset_split_days (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_split_id  INTEGER NOT NULL REFERENCES preset_splits(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  day_index        INTEGER NOT NULL,
  location         TEXT NOT NULL CHECK (location IN ('gym','home'))
);

CREATE TABLE IF NOT EXISTS preset_split_day_muscles (
  preset_split_day_id  INTEGER NOT NULL REFERENCES preset_split_days(id) ON DELETE CASCADE,
  muscle_id            INTEGER NOT NULL REFERENCES muscles(id) ON DELETE CASCADE,
  PRIMARY KEY (preset_split_day_id, muscle_id)
);

CREATE TABLE IF NOT EXISTS preset_split_exercises (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_split_day_id  INTEGER NOT NULL REFERENCES preset_split_days(id) ON DELETE CASCADE,
  exercise_id          TEXT NOT NULL REFERENCES exercises(id),
  position             INTEGER NOT NULL,
  target_sets          INTEGER,
  target_reps          INTEGER,
  target_rpe           REAL
);

-- Gamification.

CREATE TABLE IF NOT EXISTS xp_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS streaks (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak    INTEGER NOT NULL DEFAULT 0,
  longest_streak    INTEGER NOT NULL DEFAULT 0,
  last_active_date  TEXT
);

CREATE TABLE IF NOT EXISTS achievements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  key            TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  icon           TEXT,
  criteria_type  TEXT NOT NULL,
  criteria_value TEXT NOT NULL,
  is_published   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id  INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_user               ON blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_split_days_block           ON split_days(block_id);
CREATE INDEX IF NOT EXISTS idx_split_exercises_day        ON split_exercises(split_day_id);
CREATE INDEX IF NOT EXISTS idx_body_metrics_user          ON body_metrics(user_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_user_targets_user           ON user_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_preset_split_days_preset    ON preset_split_days(preset_split_id);
CREATE INDEX IF NOT EXISTS idx_preset_split_exercises_day  ON preset_split_exercises(preset_split_day_id);
CREATE INDEX IF NOT EXISTS idx_xp_ledger_user              ON xp_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user      ON user_achievements(user_id);
```

**Step 2: Sanity-check the file parses**

`seed.ts` splits `schema.sql` on `;` and executes each statement, so a stray `;` inside a string would break it — there isn't one here, but confirm by running the seed script against a real (or scratch) Turso DB once `.env` is populated:

Run: `npm run db:seed`
Expected: `Seeding 873 exercises...` then `Done.` with no SQL errors. (If you don't have Turso credentials handy, skip this — Task 5's in-memory test DB will exercise the same DDL and is what the rest of this plan actually depends on.)

---

## Task 5: In-memory test database helper

**Files:**
- Create: `server/utils/test/create-test-db.ts`

This is what every repository/service test in this plan uses instead of a real Turso instance.

**Step 1: Write it**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(__dirname, '../../database/schema.sql')

export function createTestDb(): Client {
  const db = createClient({ url: ':memory:' })
  const schema = readFileSync(schemaPath, 'utf-8')
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    db.execute(statement)
  }
  return db
}
```

`db.execute` on a freshly created local client resolves synchronously-enough in practice for DDL during setup, but to be safe make this async and await each statement — revise to:

```ts
export async function createTestDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' })
  const schema = readFileSync(schemaPath, 'utf-8')
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    await db.execute(statement)
  }
  return db
}
```

**Step 2: Verify it works with a throwaway test**

Create a temporary `server/utils/test/create-test-db.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createTestDb } from './create-test-db'

describe('createTestDb', () => {
  it('applies the schema so known tables exist', async () => {
    const db = await createTestDb()
    const result = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='exercises'`,
    )
    expect(result.rows.length).toBe(1)
  })
})
```

Run: `npx vitest run server/utils/test/create-test-db.test.ts`
Expected: PASS.

Leave this test file in place — it's a real regression test for the helper (if someone breaks `schema.sql`'s syntax, this catches it before any other repository test does).

---

## Task 6: `BaseRepository`

**Files:**
- Create: `server/repositories/base.repository.ts`
- Test: `server/repositories/base.repository.test.ts`

**Step 1: Write the failing test**

Tests it against a throwaway table + concrete subclass, since `BaseRepository` is abstract.

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { BaseRepository } from './base.repository'

interface Widget {
  id: number
  name: string
}

class WidgetRepository extends BaseRepository<Widget> {
  protected tableName = 'widgets'
  protected mapRow(row: Record<string, unknown>): Widget {
    return { id: row.id as number, name: row.name as string }
  }
}

describe('BaseRepository', () => {
  let db: Client
  let repo: WidgetRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute('CREATE TABLE widgets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)')
    repo = new WidgetRepository(db)
  })

  it('inserts and finds by id', async () => {
    const created = await repo.insert({ name: 'sprocket' })
    expect(created.name).toBe('sprocket')

    const found = await repo.findById(created.id)
    expect(found).toEqual(created)
  })

  it('returns null from findById when missing', async () => {
    expect(await repo.findById(999)).toBeNull()
  })

  it('finds many by a where clause', async () => {
    await repo.insert({ name: 'a' })
    await repo.insert({ name: 'a' })
    await repo.insert({ name: 'b' })

    expect(await repo.findMany({ name: 'a' })).toHaveLength(2)
    expect(await repo.findMany()).toHaveLength(3)
  })

  it('updates a row', async () => {
    const created = await repo.insert({ name: 'old' })
    const updated = await repo.update(created.id, { name: 'new' })
    expect(updated?.name).toBe('new')
  })

  it('deletes a row', async () => {
    const created = await repo.insert({ name: 'gone' })
    await repo.delete(created.id)
    expect(await repo.findById(created.id)).toBeNull()
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run server/repositories/base.repository.test.ts`
Expected: FAIL — `base.repository.ts` doesn't exist.

**Step 3: Implement**

```ts
import type { Client } from '@libsql/client'

export abstract class BaseRepository<T> {
  protected abstract tableName: string

  constructor(protected db: Client) {}

  protected abstract mapRow(row: Record<string, unknown>): T

  async findById(id: string | number): Promise<T | null> {
    const result = await this.db.execute({
      sql: `SELECT * FROM ${this.tableName} WHERE id = ?`,
      args: [id],
    })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async findMany(where: Record<string, string | number> = {}): Promise<T[]> {
    const keys = Object.keys(where)
    const clause = keys.length ? `WHERE ${keys.map(k => `${k} = ?`).join(' AND ')}` : ''
    const result = await this.db.execute({
      sql: `SELECT * FROM ${this.tableName} ${clause}`,
      args: keys.map(k => where[k]),
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }

  async insert(data: Record<string, unknown>): Promise<T> {
    const keys = Object.keys(data)
    const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING *`
    const result = await this.db.execute({ sql, args: keys.map(k => data[k] as never) })
    return this.mapRow(result.rows[0] as unknown as Record<string, unknown>)
  }

  async update(id: string | number, data: Record<string, unknown>): Promise<T | null> {
    const keys = Object.keys(data)
    if (!keys.length) return this.findById(id)
    const sql = `UPDATE ${this.tableName} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`
    const result = await this.db.execute({ sql, args: [...keys.map(k => data[k] as never), id] })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async delete(id: string | number): Promise<void> {
    await this.db.execute({ sql: `DELETE FROM ${this.tableName} WHERE id = ?`, args: [id] })
  }
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run server/repositories/base.repository.test.ts`
Expected: all 5 pass.

---

## Task 7: `BaseService`

**Files:**
- Create: `server/services/base.service.ts` (currently an empty file)
- Test: `server/services/base.service.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { BaseService } from './base.service'
import type { RequestContext } from '../../shared/types/rbac.types'

class TestService extends BaseService {
  checkOwner(resourceUserId: string) {
    this.requireOwner(resourceUserId)
  }
  checkPermission(permission: string) {
    this.requirePermission(permission)
  }
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return { userId: 'user-1', roles: [], permissions: [], ...overrides }
}

describe('BaseService', () => {
  it('requireOwner passes when the resource belongs to the current user', () => {
    const service = new TestService(ctx({ userId: 'user-1' }))
    expect(() => service.checkOwner('user-1')).not.toThrow()
  })

  it('requireOwner throws a 403 when the resource belongs to someone else', () => {
    const service = new TestService(ctx({ userId: 'user-1' }))
    expect(() => service.checkOwner('user-2')).toThrow(/forbidden/i)
  })

  it('requirePermission passes when the permission is present', () => {
    const service = new TestService(ctx({ permissions: ['preset:write'] }))
    expect(() => service.checkPermission('preset:write')).not.toThrow()
  })

  it('requirePermission throws a 403 when the permission is missing', () => {
    const service = new TestService(ctx({ permissions: [] }))
    expect(() => service.checkPermission('preset:write')).toThrow(/forbidden/i)
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run server/services/base.service.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
import { createError } from 'h3'
import type { RequestContext } from '../../shared/types/rbac.types'

export abstract class BaseService {
  constructor(protected ctx: RequestContext) {}

  protected requireOwner(resourceUserId: string): void {
    if (resourceUserId !== this.ctx.userId) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }
  }

  protected requirePermission(permission: string): void {
    if (!this.ctx.permissions.includes(permission)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }
  }
}
```

`h3` is a transitive dependency already pulled in by Nuxt/Nitro, so no install is needed — confirm with `npm ls h3` if the import fails to resolve in the test runner; if it doesn't resolve outside the Nuxt build context, add it explicitly with `npm install h3`.

**Step 4: Run to verify pass**

Run: `npx vitest run server/services/base.service.test.ts`
Expected: all 4 pass.

---

## Task 8: Role repository/service + RequestContext builder

**Files:**
- Create: `server/repositories/role.repository.ts`
- Create: `server/services/role.service.ts`
- Create: `server/utils/build-request-context.ts`
- Test: `server/repositories/role.repository.test.ts`
- Test: `server/utils/build-request-context.test.ts`

**Step 1: Write the failing repository test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { RoleRepository } from './role.repository'

describe('RoleRepository', () => {
  let db: Client
  let repo: RoleRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new RoleRepository(db)
  })

  it('round-trips the permissions array through JSON', async () => {
    const role = await repo.insert({ key: 'admin', name: 'Admin', permissions: ['preset:write', 'achievement:write'] })
    expect(role.permissions).toEqual(['preset:write', 'achievement:write'])

    const found = await repo.findById(role.id)
    expect(found?.permissions).toEqual(['preset:write', 'achievement:write'])
  })

  it('finds a role by key', async () => {
    await repo.insert({ key: 'member', name: 'Member', permissions: [] })
    const found = await repo.findByKey('member')
    expect(found?.name).toBe('Member')
  })

  it('assigns and lists roles for a user', async () => {
    const role = await repo.insert({ key: 'admin', name: 'Admin', permissions: ['preset:write'] })
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })

    await repo.assignToUser('user-1', role.id)
    const roles = await repo.findForUser('user-1')
    expect(roles).toHaveLength(1)
    expect(roles[0].key).toBe('admin')
  })
})
```

**Step 2: Run to verify failure, then implement `role.repository.ts`**

```ts
import { BaseRepository } from './base.repository'
import type { Role } from '../../shared/types/rbac.types'

export class RoleRepository extends BaseRepository<Role> {
  protected tableName = 'roles'

  protected mapRow(row: Record<string, unknown>): Role {
    return {
      id: row.id as number,
      key: row.key as string,
      name: row.name as string,
      permissions: JSON.parse(row.permissions as string),
    }
  }

  async insert(data: { key: string, name: string, permissions: string[] }): Promise<Role> {
    return super.insert({ key: data.key, name: data.name, permissions: JSON.stringify(data.permissions) })
  }

  async findByKey(key: string): Promise<Role | null> {
    const roles = await this.findMany({ key })
    return roles[0] ?? null
  }

  async assignToUser(userId: string, roleId: number): Promise<void> {
    await this.db.execute({
      sql: 'INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
      args: [userId, roleId],
    })
  }

  async findForUser(userId: string): Promise<Role[]> {
    const result = await this.db.execute({
      sql: `SELECT roles.* FROM roles
            JOIN user_roles ON user_roles.role_id = roles.id
            WHERE user_roles.user_id = ?`,
      args: [userId],
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }
}
```

**Step 3: Run to verify pass**

Run: `npx vitest run server/repositories/role.repository.test.ts`
Expected: all 3 pass.

**Step 4: Write the failing test for `buildRequestContext`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from './test/create-test-db'
import { RoleRepository } from '../repositories/role.repository'
import { buildRequestContext } from './build-request-context'

describe('buildRequestContext', () => {
  let db: Client

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  })

  it('flattens and dedupes permissions across all of a user\'s roles', async () => {
    const roles = new RoleRepository(db)
    const admin = await roles.insert({ key: 'admin', name: 'Admin', permissions: ['preset:write', 'shared:read'] })
    const editor = await roles.insert({ key: 'editor', name: 'Editor', permissions: ['shared:read', 'achievement:write'] })
    await roles.assignToUser('user-1', admin.id)
    await roles.assignToUser('user-1', editor.id)

    const ctx = await buildRequestContext(db, 'user-1')

    expect(ctx.userId).toBe('user-1')
    expect(ctx.roles.sort()).toEqual(['admin', 'editor'])
    expect(ctx.permissions.sort()).toEqual(['achievement:write', 'preset:write', 'shared:read'])
  })

  it('returns empty roles/permissions for a user with no roles', async () => {
    const ctx = await buildRequestContext(db, 'user-1')
    expect(ctx.roles).toEqual([])
    expect(ctx.permissions).toEqual([])
  })
})
```

**Step 5: Implement `build-request-context.ts`**

```ts
import type { Client } from '@libsql/client'
import { RoleRepository } from '../repositories/role.repository'
import type { RequestContext } from '../../shared/types/rbac.types'

export async function buildRequestContext(db: Client, userId: string): Promise<RequestContext> {
  const roles = await new RoleRepository(db).findForUser(userId)
  const permissions = [...new Set(roles.flatMap(role => role.permissions))]
  return { userId, roles: roles.map(role => role.key), permissions }
}
```

**Step 6: Run both test files**

Run: `npx vitest run server/utils/build-request-context.test.ts server/repositories/role.repository.test.ts`
Expected: all pass.

**`role.service.ts`** — thin, admin-only writes:

```ts
import { BaseService } from './base.service'
import { RoleRepository } from '../repositories/role.repository'
import type { RequestContext } from '../../shared/types/rbac.types'
import type { Role } from '../../shared/types/rbac.types'

export class RoleService extends BaseService {
  constructor(ctx: RequestContext, private roles: RoleRepository) {
    super(ctx)
  }

  async assignRole(userId: string, roleKey: string): Promise<void> {
    this.requirePermission('role:write')
    const role = await this.roles.findByKey(roleKey)
    if (!role) throw new Error(`Unknown role: ${roleKey}`)
    await this.roles.assignToUser(userId, role.id)
  }
}
```

No dedicated test for this trivial pass-through/permission-gate — it's exercised end-to-end in Task 17's seed step and Task 18's admin routes. (If you'd rather have unit coverage here, mirror the `requirePermission` pattern already tested in Task 7.)

---

## Task 9: Exercise & Muscle repositories/services (repository-pattern the existing catalog)

**Files:**
- Create: `server/repositories/muscle.repository.ts`
- Create: `server/repositories/exercise.repository.ts`
- Create: `server/services/muscle.service.ts`
- Create: `server/services/exercise.service.ts`
- Test: `server/repositories/muscle.repository.test.ts`
- Test: `server/repositories/exercise.repository.test.ts`

This doesn't touch `seed.ts` or `db.ts` — it adds the repository layer on top of the existing tables so `split`/`preset-split` code (Tasks 12–14) has something typed to call, instead of hand-writing SQL against `exercises`/`muscles` again.

**Step 1: Write the failing muscle repository test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { MuscleRepository } from './muscle.repository'

describe('MuscleRepository', () => {
  let db: Client
  let repo: MuscleRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new MuscleRepository(db)
  })

  it('inserts and finds a muscle by name', async () => {
    await repo.insert({ name: 'chest' })
    const found = await repo.findByName('chest')
    expect(found?.name).toBe('chest')
  })

  it('getOrCreate reuses an existing row instead of duplicating', async () => {
    const first = await repo.getOrCreate('quadriceps')
    const second = await repo.getOrCreate('quadriceps')
    expect(first.id).toBe(second.id)
  })
})
```

**Step 2: Implement `muscle.repository.ts`**

```ts
import { BaseRepository } from './base.repository'
import type { Muscle } from '../../shared/types/exercise.types'

export class MuscleRepository extends BaseRepository<Muscle> {
  protected tableName = 'muscles'

  protected mapRow(row: Record<string, unknown>): Muscle {
    return { id: row.id as number, name: row.name as string }
  }

  async findByName(name: string): Promise<Muscle | null> {
    const muscles = await this.findMany({ name })
    return muscles[0] ?? null
  }

  async getOrCreate(name: string): Promise<Muscle> {
    const existing = await this.findByName(name)
    if (existing) return existing
    return this.insert({ name })
  }
}
```

**Step 3: Run muscle test to verify pass**

Run: `npx vitest run server/repositories/muscle.repository.test.ts`
Expected: pass.

**Step 4: Write the failing exercise repository test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { MuscleRepository } from './muscle.repository'
import { ExerciseRepository } from './exercise.repository'

async function seedExercise(db: Client, id: string, muscleId: number) {
  await db.execute({
    sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
          VALUES (?, ?, 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    args: [id, id],
  })
  await db.execute({
    sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)',
    args: [id, muscleId, 'primary'],
  })
}

describe('ExerciseRepository', () => {
  let db: Client
  let repo: ExerciseRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new ExerciseRepository(db)
  })

  it('finds an exercise by id and parses instructions JSON', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '["Lie down", "Press up"]')`,
    })
    const found = await repo.findById('bench-press')
    expect(found?.instructions).toEqual(['Lie down', 'Press up'])
  })

  it('finds exercises that target a given muscle', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    const back = await muscles.getOrCreate('back')
    await seedExercise(db, 'bench-press', chest.id)
    await seedExercise(db, 'row', back.id)

    const results = await repo.findByMuscle(chest.id)
    expect(results.map(e => e.id)).toEqual(['bench-press'])
  })
})
```

**Step 5: Implement `exercise.repository.ts`**

```ts
import { BaseRepository } from './base.repository'
import type { Exercise } from '../../shared/types/exercise.types'

export class ExerciseRepository extends BaseRepository<Exercise> {
  protected tableName = 'exercises'

  protected mapRow(row: Record<string, unknown>): Exercise {
    return {
      id: row.id as string,
      name: row.name as string,
      category: row.category as string | null,
      equipment: row.equipment as string | null,
      force: row.force as string | null,
      level: row.level as string | null,
      mechanic: row.mechanic as string | null,
      instructions: JSON.parse((row.instructions as string) ?? '[]'),
    }
  }

  async findByMuscle(muscleId: number): Promise<Exercise[]> {
    const result = await this.db.execute({
      sql: `SELECT exercises.* FROM exercises
            JOIN exercise_muscles ON exercise_muscles.exercise_id = exercises.id
            WHERE exercise_muscles.muscle_id = ?
            GROUP BY exercises.id`,
      args: [muscleId],
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }
}
```

**Step 6: Run to verify pass**

Run: `npx vitest run server/repositories/exercise.repository.test.ts`
Expected: pass.

**Step 7: Thin services**

`server/services/muscle.service.ts`:

```ts
import { BaseService } from './base.service'
import { MuscleRepository } from '../repositories/muscle.repository'
import type { RequestContext } from '../../shared/types/rbac.types'

export class MuscleService extends BaseService {
  constructor(ctx: RequestContext, private muscles: MuscleRepository) {
    super(ctx)
  }

  list() {
    return this.muscles.findMany()
  }
}
```

`server/services/exercise.service.ts`:

```ts
import { BaseService } from './base.service'
import { ExerciseRepository } from '../repositories/exercise.repository'
import type { RequestContext } from '../../shared/types/rbac.types'

export class ExerciseService extends BaseService {
  constructor(ctx: RequestContext, private exercises: ExerciseRepository) {
    super(ctx)
  }

  getById(id: string) {
    return this.exercises.findById(id)
  }

  findByMuscle(muscleId: number) {
    return this.exercises.findByMuscle(muscleId)
  }
}
```

Catalog data is global/read-only from the app's point of view, so no `requireOwner` calls belong here — there's no owner to check.

---

## Task 10: Profile, body metrics, and targets

**Files:**
- Create: `server/repositories/profile.repository.ts`
- Create: `server/repositories/body-metrics.repository.ts`
- Create: `server/repositories/target.repository.ts`
- Create: `server/services/profile.service.ts`
- Create: `server/services/body-metrics.service.ts`
- Create: `server/services/target.service.ts`
- Test: `server/repositories/profile.repository.test.ts`
- Test: `server/repositories/body-metrics.repository.test.ts`
- Test: `server/services/profile.service.test.ts`

**Step 1: Write the failing profile repository test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { ProfileRepository } from './profile.repository'

describe('ProfileRepository', () => {
  let db: Client
  let repo: ProfileRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new ProfileRepository(db)
  })

  it('upserts a profile (insert then update, keyed on user_id)', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180 })
    const first = await repo.findByUserId('user-1')
    expect(first?.heightCm).toBe(180)

    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 182 })
    const second = await repo.findByUserId('user-1')
    expect(second?.heightCm).toBe(182)
  })

  it('returns null for a user with no profile yet', async () => {
    expect(await repo.findByUserId('nobody')).toBeNull()
  })
})
```

**Step 2: Implement `profile.repository.ts`**

`user_profiles.user_id` is the primary key, so "upsert" is `INSERT ... ON CONFLICT (user_id) DO UPDATE`:

```ts
import type { Client } from '@libsql/client'
import type { ActivityLevel, Gender } from '../../shared/lib/formulas'
import type { ExperienceLevel, Goal, UserProfile } from '../../shared/types/profile.types'

export interface UpsertProfileInput {
  dateOfBirth: string
  gender: Gender
  heightCm: number
  activityLevel?: ActivityLevel | null
  experienceLevel?: ExperienceLevel | null
  primaryGoal?: Goal | null
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
      sql: `INSERT INTO user_profiles (user_id, date_of_birth, gender, height_cm, activity_level, experience_level, primary_goal, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT (user_id) DO UPDATE SET
              date_of_birth = excluded.date_of_birth,
              gender = excluded.gender,
              height_cm = excluded.height_cm,
              activity_level = excluded.activity_level,
              experience_level = excluded.experience_level,
              primary_goal = excluded.primary_goal,
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
      ],
    })
    return this.mapRow(result.rows[0] as unknown as Record<string, unknown>)
  }
}
```

This one doesn't extend `BaseRepository` — its primary key is `user_id`, not `id`, so the generic `findById`/`update` don't fit; it's small enough that a bespoke class is clearer than forcing the base class's shape. Note that as a deliberate exception, not an oversight.

**Step 3: Run to verify pass**

Run: `npx vitest run server/repositories/profile.repository.test.ts`
Expected: pass.

**Step 4: Body metrics repository — failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { BodyMetricsRepository } from './body-metrics.repository'

describe('BodyMetricsRepository', () => {
  let db: Client
  let repo: BodyMetricsRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new BodyMetricsRepository(db)
  })

  it('records an entry with measurements and reads it back', async () => {
    const entry = await repo.record('user-1', {
      recordedAt: '2026-08-18',
      weightKg: 80,
      source: 'manual',
      measurements: [{ key: 'waist', valueCm: 85 }, { key: 'chest', valueCm: 105 }],
    })
    expect(entry.measurements).toHaveLength(2)

    const [latest] = await repo.findForUser('user-1')
    expect(latest.weightKg).toBe(80)
    expect(latest.measurements.map(m => m.key).sort()).toEqual(['chest', 'waist'])
  })

  it('orders findForUser by recorded_at descending', async () => {
    await repo.record('user-1', { recordedAt: '2026-08-01', weightKg: 82, source: 'manual', measurements: [] })
    await repo.record('user-1', { recordedAt: '2026-08-15', weightKg: 80, source: 'manual', measurements: [] })

    const results = await repo.findForUser('user-1')
    expect(results.map(r => r.recordedAt)).toEqual(['2026-08-15', '2026-08-01'])
  })
})
```

**Step 5: Implement `body-metrics.repository.ts`**

```ts
import type { Client } from '@libsql/client'
import type { BodyMetric, MetricSource } from '../../shared/types/profile.types'

export interface RecordBodyMetricInput {
  recordedAt: string
  weightKg: number
  bodyFatPct?: number | null
  visceralFat?: number | null
  muscleMassKg?: number | null
  source: MetricSource
  measurements: { key: string, valueCm: number }[]
}

export class BodyMetricsRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): Omit<BodyMetric, 'measurements'> {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      recordedAt: row.recorded_at as string,
      weightKg: row.weight_kg as number,
      bodyFatPct: row.body_fat_pct as number | null,
      visceralFat: row.visceral_fat as number | null,
      muscleMassKg: row.muscle_mass_kg as number | null,
      source: row.source as MetricSource,
    }
  }

  private async loadMeasurements(bodyMetricId: number) {
    const result = await this.db.execute({
      sql: 'SELECT * FROM body_metric_measurements WHERE body_metric_id = ?',
      args: [bodyMetricId],
    })
    return result.rows.map(row => ({
      id: row.id as number,
      bodyMetricId: row.body_metric_id as number,
      key: row.key as string,
      valueCm: row.value_cm as number,
    }))
  }

  async record(userId: string, input: RecordBodyMetricInput): Promise<BodyMetric> {
    const result = await this.db.execute({
      sql: `INSERT INTO body_metrics (user_id, recorded_at, weight_kg, body_fat_pct, visceral_fat, muscle_mass_kg, source)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        userId,
        input.recordedAt,
        input.weightKg,
        input.bodyFatPct ?? null,
        input.visceralFat ?? null,
        input.muscleMassKg ?? null,
        input.source,
      ],
    })
    const row = this.mapRow(result.rows[0] as unknown as Record<string, unknown>)

    for (const m of input.measurements) {
      await this.db.execute({
        sql: 'INSERT INTO body_metric_measurements (body_metric_id, key, value_cm) VALUES (?, ?, ?)',
        args: [row.id, m.key, m.valueCm],
      })
    }

    return { ...row, measurements: await this.loadMeasurements(row.id) }
  }

  async findForUser(userId: string): Promise<BodyMetric[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM body_metrics WHERE user_id = ? ORDER BY recorded_at DESC',
      args: [userId],
    })
    const rows = result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
    return Promise.all(rows.map(async row => ({ ...row, measurements: await this.loadMeasurements(row.id) })))
  }
}
```

**Step 6: Run to verify pass**

Run: `npx vitest run server/repositories/body-metrics.repository.test.ts`
Expected: pass.

**Step 7: `target.repository.ts`** (same shape as body metrics, no separate test — the pattern is already covered; add one only if `findActiveForUser` logic below feels risky enough to want a regression test, which it's simple enough not to)

```ts
import type { Client } from '@libsql/client'
import type { TargetMetric, UserTarget } from '../../shared/types/profile.types'

export interface CreateTargetInput {
  metric: TargetMetric
  targetValue: number
  targetDate?: string | null
  startingValue: number
  startingRecordedAt: string
}

export class TargetRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): UserTarget {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      metric: row.metric as TargetMetric,
      targetValue: row.target_value as number,
      targetDate: row.target_date as string | null,
      startingValue: row.starting_value as number,
      startingRecordedAt: row.starting_recorded_at as string,
      achievedAt: row.achieved_at as string | null,
      isActive: Boolean(row.is_active),
    }
  }

  async create(userId: string, input: CreateTargetInput): Promise<UserTarget> {
    const result = await this.db.execute({
      sql: `INSERT INTO user_targets (user_id, metric, target_value, target_date, starting_value, starting_recorded_at, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING *`,
      args: [userId, input.metric, input.targetValue, input.targetDate ?? null, input.startingValue, input.startingRecordedAt],
    })
    return this.mapRow(result.rows[0] as unknown as Record<string, unknown>)
  }

  async findActiveForUser(userId: string): Promise<UserTarget[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM user_targets WHERE user_id = ? AND is_active = 1',
      args: [userId],
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }

  async markAchieved(id: number): Promise<void> {
    await this.db.execute({
      sql: `UPDATE user_targets SET achieved_at = datetime('now'), is_active = 0 WHERE id = ?`,
      args: [id],
    })
  }
}
```

**Step 8: `profile.service.ts` — the piece with real logic (BMI/TDEE lookups + required-field validation), TDD it**

Failing test:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { ProfileRepository } from '../repositories/profile.repository'
import { BodyMetricsRepository } from '../repositories/body-metrics.repository'
import { ProfileService } from './profile.service'
import type { RequestContext } from '../../shared/types/rbac.types'

describe('ProfileService', () => {
  let db: Client
  let service: ProfileService
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db))
  })

  it('completes onboarding by saving the profile and the first weight entry', async () => {
    await service.completeOnboarding({
      dateOfBirth: '1995-06-15',
      gender: 'male',
      heightCm: 178,
      weightKg: 75,
    })

    const profile = await service.getProfile()
    expect(profile?.heightCm).toBe(178)

    const metrics = await new BodyMetricsRepository(db).findForUser('user-1')
    expect(metrics).toHaveLength(1)
    expect(metrics[0].weightKg).toBe(75)
  })

  it('computes BMI and TDEE from the latest profile + weight once onboarding is done', async () => {
    await service.completeOnboarding({
      dateOfBirth: '1995-06-15',
      gender: 'male',
      heightCm: 178,
      weightKg: 75,
      activityLevel: 'moderately_active',
    })

    const stats = await service.getComputedStats()
    expect(stats?.bmi).toBeGreaterThan(20)
    expect(stats?.tdee).toBeGreaterThan(1500)
  })

  it('returns null computed stats when there is no profile yet', async () => {
    expect(await service.getComputedStats()).toBeNull()
  })
})
```

Implementation:

```ts
import { BaseService } from './base.service'
import { ProfileRepository } from '../repositories/profile.repository'
import { BodyMetricsRepository } from '../repositories/body-metrics.repository'
import { bmi, tdee } from '../../shared/lib/formulas'
import type { RequestContext } from '../../shared/types/rbac.types'
import type { ActivityLevel, Gender } from '../../shared/lib/formulas'
import type { ExperienceLevel, Goal } from '../../shared/types/profile.types'

export interface CompleteOnboardingInput {
  dateOfBirth: string
  gender: Gender
  heightCm: number
  weightKg: number
  activityLevel?: ActivityLevel
  experienceLevel?: ExperienceLevel
  primaryGoal?: Goal
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
  ) {
    super(ctx)
  }

  async completeOnboarding(input: CompleteOnboardingInput) {
    await this.profiles.upsert(this.ctx.userId, {
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      heightCm: input.heightCm,
      activityLevel: input.activityLevel ?? null,
      experienceLevel: input.experienceLevel ?? null,
      primaryGoal: input.primaryGoal ?? null,
    })
    await this.bodyMetrics.record(this.ctx.userId, {
      recordedAt: new Date().toISOString().slice(0, 10),
      weightKg: input.weightKg,
      source: 'manual',
      measurements: [],
    })
  }

  getProfile() {
    return this.profiles.findByUserId(this.ctx.userId)
  }

  async getComputedStats(): Promise<{ bmi: number, tdee: number | null } | null> {
    const profile = await this.profiles.findByUserId(this.ctx.userId)
    if (!profile) return null

    const [latestMetric] = await this.bodyMetrics.findForUser(this.ctx.userId)
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

**Step 9: Run to verify pass**

Run: `npx vitest run server/services/profile.service.test.ts`
Expected: all 3 pass.

**Step 10: `target.service.ts`** — thin, ownership-checked, no new logic worth a dedicated test beyond what `BaseService.requireOwner` already covers in Task 7:

```ts
import { BaseService } from './base.service'
import { TargetRepository, type CreateTargetInput } from '../repositories/target.repository'
import type { RequestContext } from '../../shared/types/rbac.types'

export class TargetService extends BaseService {
  constructor(ctx: RequestContext, private targets: TargetRepository) {
    super(ctx)
  }

  create(input: CreateTargetInput) {
    return this.targets.create(this.ctx.userId, input)
  }

  listActive() {
    return this.targets.findActiveForUser(this.ctx.userId)
  }
}
```

`body-metrics.service.ts` similarly:

```ts
import { BaseService } from './base.service'
import { BodyMetricsRepository, type RecordBodyMetricInput } from '../repositories/body-metrics.repository'
import type { RequestContext } from '../../shared/types/rbac.types'

export class BodyMetricsService extends BaseService {
  constructor(ctx: RequestContext, private metrics: BodyMetricsRepository) {
    super(ctx)
  }

  record(input: RecordBodyMetricInput) {
    return this.metrics.record(this.ctx.userId, input)
  }

  list() {
    return this.metrics.findForUser(this.ctx.userId)
  }
}
```

---

## Task 11: Program/Block/SplitDay/SplitExercise ("from scratch" creation)

**Files:**
- Create: `server/repositories/block.repository.ts`
- Create: `server/services/split.service.ts`
- Test: `server/repositories/block.repository.test.ts`
- Test: `server/services/split.service.test.ts`

The interesting part here is that creating a Block with its SplitDays/SplitExercises has to happen as one transaction — a half-written Block (days but no exercises, or vice versa) is a real bug, not a hypothetical.

**Step 1: Write the failing repository test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { BlockRepository } from './block.repository'

describe('BlockRepository', () => {
  let db: Client
  let repo: BlockRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    repo = new BlockRepository(db)
  })

  it('creates a block with nested split days and exercises in one call', async () => {
    const block = await repo.createWithDays('user-1', {
      programId: null,
      name: 'Push Pull Legs',
      startDate: '2026-08-18',
      endDate: null,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: [
        {
          name: 'Push',
          dayOfWeek: 1,
          location: 'gym',
          exercises: [{ exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 4, targetReps: 8, targetRpe: 8 }],
        },
      ],
    })

    const full = await repo.findWithDays(block.id)
    expect(full?.days).toHaveLength(1)
    expect(full?.days[0].exercises).toHaveLength(1)
    expect(full?.days[0].exercises[0].exerciseId).toBe('bench-press')
  })

  it('creates an implicit program when programId is not provided', async () => {
    const block = await repo.createWithDays('user-1', {
      programId: null,
      name: 'Solo Block',
      startDate: '2026-08-18',
      endDate: null,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: [],
    })
    const program = await db.execute({ sql: 'SELECT * FROM programs WHERE id = ?', args: [block.programId] })
    expect(program.rows).toHaveLength(1)
  })
})
```

**Step 2: Implement `block.repository.ts`**

```ts
import type { Client } from '@libsql/client'
import type { Block, MacroTarget, SetType, SplitDay, SplitExercise } from '../../shared/types/split.types'

export interface CreateSplitExerciseInput {
  exerciseId: string
  position: number
  setType: SetType
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}

export interface CreateSplitDayInput {
  name: string
  dayOfWeek: number
  location: 'gym' | 'home'
  exercises: CreateSplitExerciseInput[]
}

export interface CreateBlockInput {
  programId: number | null
  name: string
  startDate: string
  endDate: string | null
  trainingDayMacroTarget: MacroTarget | null
  restDayMacroTarget: MacroTarget | null
  days: CreateSplitDayInput[]
}

export interface BlockWithDays extends Block {
  days: (SplitDay & { exercises: SplitExercise[] })[]
}

export class BlockRepository {
  constructor(private db: Client) {}

  private mapBlock(row: Record<string, unknown>): Block {
    return {
      id: row.id as number,
      programId: row.program_id as number,
      userId: row.user_id as string,
      name: row.name as string,
      startDate: row.start_date as string,
      endDate: row.end_date as string | null,
      trainingDayMacroTarget: row.training_day_macro_target ? JSON.parse(row.training_day_macro_target as string) : null,
      restDayMacroTarget: row.rest_day_macro_target ? JSON.parse(row.rest_day_macro_target as string) : null,
    }
  }

  async createWithDays(userId: string, input: CreateBlockInput): Promise<Block> {
    let programId = input.programId
    if (programId === null) {
      const program = await this.db.execute({
        sql: 'INSERT INTO programs (user_id, name) VALUES (?, ?) RETURNING *',
        args: [userId, input.name],
      })
      programId = program.rows[0].id as number
    }

    const blockResult = await this.db.execute({
      sql: `INSERT INTO blocks (program_id, user_id, name, start_date, end_date, training_day_macro_target, rest_day_macro_target)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        programId,
        userId,
        input.name,
        input.startDate,
        input.endDate,
        input.trainingDayMacroTarget ? JSON.stringify(input.trainingDayMacroTarget) : null,
        input.restDayMacroTarget ? JSON.stringify(input.restDayMacroTarget) : null,
      ],
    })
    const block = this.mapBlock(blockResult.rows[0] as unknown as Record<string, unknown>)

    for (const day of input.days) {
      const dayResult = await this.db.execute({
        sql: 'INSERT INTO split_days (block_id, name, day_of_week, location) VALUES (?, ?, ?, ?) RETURNING *',
        args: [block.id, day.name, day.dayOfWeek, day.location],
      })
      const dayId = dayResult.rows[0].id as number

      for (const exercise of day.exercises) {
        await this.db.execute({
          sql: `INSERT INTO split_exercises (split_day_id, exercise_id, position, set_type, target_sets, target_reps, target_rpe)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [dayId, exercise.exerciseId, exercise.position, exercise.setType, exercise.targetSets, exercise.targetReps, exercise.targetRpe],
        })
      }
    }

    return block
  }

  async findWithDays(blockId: number): Promise<BlockWithDays | null> {
    const blockResult = await this.db.execute({ sql: 'SELECT * FROM blocks WHERE id = ?', args: [blockId] })
    const blockRow = blockResult.rows[0]
    if (!blockRow) return null
    const block = this.mapBlock(blockRow as unknown as Record<string, unknown>)

    const daysResult = await this.db.execute({ sql: 'SELECT * FROM split_days WHERE block_id = ? ORDER BY day_of_week', args: [blockId] })
    const days = await Promise.all(
      daysResult.rows.map(async (dayRow) => {
        const day = dayRow as unknown as Record<string, unknown>
        const dayId = day.id as number
        const exercisesResult = await this.db.execute({
          sql: 'SELECT * FROM split_exercises WHERE split_day_id = ? ORDER BY position',
          args: [dayId],
        })
        const exercises: SplitExercise[] = exercisesResult.rows.map((exRow) => {
          const ex = exRow as unknown as Record<string, unknown>
          return {
            id: ex.id as number,
            splitDayId: ex.split_day_id as number,
            exerciseId: ex.exercise_id as string,
            position: ex.position as number,
            setType: ex.set_type as SetType,
            targetSets: ex.target_sets as number | null,
            targetReps: ex.target_reps as number | null,
            targetRpe: ex.target_rpe as number | null,
          }
        })
        return {
          id: dayId,
          blockId: day.block_id as number,
          name: day.name as string,
          dayOfWeek: day.day_of_week as number,
          location: day.location as 'gym' | 'home',
          exercises,
        }
      }),
    )

    return { ...block, days }
  }
}
```

Note: `@libsql/client`'s `db.execute` calls here aren't wrapped in an explicit `db.batch`/transaction — Turso/libSQL's local `:memory:` client executes sequentially on one connection, so partial failure ordering is deterministic for tests, but **flag this for follow-up**: a real multi-statement transaction (`db.batch([...], 'write')`) should wrap `createWithDays` before this ships against a real Turso instance, so a failure partway through (e.g. a bad `exercise_id`) can't leave an orphaned Block. Out of scope to fully solve in this pass since `@libsql/client`'s batch API takes a flat statement list, which means restructuring this method to build all statements upfront — worth its own follow-up task rather than folding into an already-large task.

**Step 3: Run to verify pass**

Run: `npx vitest run server/repositories/block.repository.test.ts`
Expected: both pass.

**Step 4: `split.service.ts` — from-scratch creation, with ownership enforcement**

Failing test:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { BlockRepository } from '../repositories/block.repository'
import { SplitService } from './split.service'
import type { RequestContext } from '../../shared/types/rbac.types'

describe('SplitService.createFromScratch', () => {
  let db: Client
  let service: SplitService
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    service = new SplitService(ctx, new BlockRepository(db))
  })

  it('creates a block owned by the current user', async () => {
    const block = await service.createFromScratch({
      name: 'My Split',
      startDate: '2026-08-18',
      endDate: null,
      days: [],
    })
    expect(block.userId).toBe('user-1')
  })
})
```

Implementation:

```ts
import { BaseService } from './base.service'
import { BlockRepository, type CreateSplitDayInput } from '../repositories/block.repository'
import type { RequestContext } from '../../shared/types/rbac.types'
import type { MacroTarget } from '../../shared/types/split.types'

export interface CreateFromScratchInput {
  name: string
  startDate: string
  endDate: string | null
  trainingDayMacroTarget?: MacroTarget | null
  restDayMacroTarget?: MacroTarget | null
  days: CreateSplitDayInput[]
}

export class SplitService extends BaseService {
  constructor(ctx: RequestContext, private blocks: BlockRepository) {
    super(ctx)
  }

  createFromScratch(input: CreateFromScratchInput) {
    return this.blocks.createWithDays(this.ctx.userId, {
      programId: null,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      trainingDayMacroTarget: input.trainingDayMacroTarget ?? null,
      restDayMacroTarget: input.restDayMacroTarget ?? null,
      days: input.days,
    })
  }

  async getOwnedBlock(blockId: number) {
    const block = await this.blocks.findWithDays(blockId)
    if (!block) return null
    this.requireOwner(block.userId)
    return block
  }
}
```

**Step 5: Run to verify pass**

Run: `npx vitest run server/services/split.service.test.ts`
Expected: pass. (`createFromPreset` is added in Task 13, once presets exist.)

---

## Task 12: Preset splits — repository, admin service, recommendation engine

**Files:**
- Create: `server/repositories/preset-split.repository.ts`
- Create: `server/services/preset-split.service.ts`
- Test: `server/repositories/preset-split.repository.test.ts`
- Test: `server/services/preset-split.service.test.ts`

**Step 1: Write the failing repository test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { MuscleRepository } from './muscle.repository'
import { PresetSplitRepository } from './preset-split.repository'

describe('PresetSplitRepository', () => {
  let db: Client
  let repo: PresetSplitRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    repo = new PresetSplitRepository(db)
  })

  it('creates a preset with nested days, target muscles, and recommended exercises', async () => {
    const chest = await new MuscleRepository(db).getOrCreate('chest')

    const preset = await repo.createWithDays({
      name: 'Push Pull Legs',
      description: 'Classic 6-day PPL',
      frequencyMinDays: 5,
      frequencyMaxDays: 6,
      goal: 'muscle_gain',
      experienceLevel: 'intermediate',
      equipment: 'gym',
      isPublished: true,
      days: [
        {
          name: 'Push',
          dayIndex: 0,
          location: 'gym',
          targetMuscleIds: [chest.id],
          exercises: [{ exerciseId: 'bench-press', position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 }],
        },
      ],
    })

    const full = await repo.findWithDays(preset.id)
    expect(full?.days).toHaveLength(1)
    expect(full?.days[0].targetMuscleIds).toEqual([chest.id])
    expect(full?.days[0].exercises[0].exerciseId).toBe('bench-press')
  })

  it('findPublished only returns published presets', async () => {
    await repo.createWithDays({
      name: 'Draft', description: null, frequencyMinDays: 3, frequencyMaxDays: 3,
      goal: null, experienceLevel: null, equipment: 'both', isPublished: false, days: [],
    })
    await repo.createWithDays({
      name: 'Live', description: null, frequencyMinDays: 3, frequencyMaxDays: 3,
      goal: null, experienceLevel: null, equipment: 'both', isPublished: true, days: [],
    })

    const published = await repo.findPublished()
    expect(published.map(p => p.name)).toEqual(['Live'])
  })
})
```

**Step 2: Implement `preset-split.repository.ts`**

```ts
import type { Client } from '@libsql/client'
import type { Equipment, PresetSplit, PresetSplitDay, PresetSplitExercise } from '../../shared/types/preset.types'
import type { ExperienceLevel, Goal } from '../../shared/types/profile.types'
import type { DayLocation } from '../../shared/types/split.types'

export interface CreatePresetExerciseInput {
  exerciseId: string
  position: number
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}

export interface CreatePresetDayInput {
  name: string
  dayIndex: number
  location: DayLocation
  targetMuscleIds: number[]
  exercises: CreatePresetExerciseInput[]
}

export interface CreatePresetSplitInput {
  name: string
  description: string | null
  frequencyMinDays: number
  frequencyMaxDays: number
  goal: Goal | null
  experienceLevel: ExperienceLevel | null
  equipment: Equipment
  isPublished: boolean
  days: CreatePresetDayInput[]
}

export interface PresetSplitWithDays extends PresetSplit {
  days: (PresetSplitDay & { exercises: PresetSplitExercise[] })[]
}

export class PresetSplitRepository {
  constructor(private db: Client) {}

  private mapPreset(row: Record<string, unknown>): PresetSplit {
    return {
      id: row.id as number,
      name: row.name as string,
      description: row.description as string | null,
      frequencyMinDays: row.frequency_min_days as number,
      frequencyMaxDays: row.frequency_max_days as number,
      goal: row.goal as Goal | null,
      experienceLevel: row.experience_level as ExperienceLevel | null,
      equipment: row.equipment as Equipment,
      isPublished: Boolean(row.is_published),
    }
  }

  async createWithDays(input: CreatePresetSplitInput): Promise<PresetSplit> {
    const result = await this.db.execute({
      sql: `INSERT INTO preset_splits (name, description, frequency_min_days, frequency_max_days, goal, experience_level, equipment, is_published)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        input.name, input.description, input.frequencyMinDays, input.frequencyMaxDays,
        input.goal, input.experienceLevel, input.equipment, input.isPublished ? 1 : 0,
      ],
    })
    const preset = this.mapPreset(result.rows[0] as unknown as Record<string, unknown>)

    for (const day of input.days) {
      const dayResult = await this.db.execute({
        sql: 'INSERT INTO preset_split_days (preset_split_id, name, day_index, location) VALUES (?, ?, ?, ?) RETURNING *',
        args: [preset.id, day.name, day.dayIndex, day.location],
      })
      const dayId = dayResult.rows[0].id as number

      for (const muscleId of day.targetMuscleIds) {
        await this.db.execute({
          sql: 'INSERT INTO preset_split_day_muscles (preset_split_day_id, muscle_id) VALUES (?, ?)',
          args: [dayId, muscleId],
        })
      }

      for (const exercise of day.exercises) {
        await this.db.execute({
          sql: `INSERT INTO preset_split_exercises (preset_split_day_id, exercise_id, position, target_sets, target_reps, target_rpe)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [dayId, exercise.exerciseId, exercise.position, exercise.targetSets, exercise.targetReps, exercise.targetRpe],
        })
      }
    }

    return preset
  }

  async findPublished(): Promise<PresetSplit[]> {
    const result = await this.db.execute('SELECT * FROM preset_splits WHERE is_published = 1')
    return result.rows.map(row => this.mapPreset(row as unknown as Record<string, unknown>))
  }

  async findWithDays(presetId: number): Promise<PresetSplitWithDays | null> {
    const presetResult = await this.db.execute({ sql: 'SELECT * FROM preset_splits WHERE id = ?', args: [presetId] })
    const presetRow = presetResult.rows[0]
    if (!presetRow) return null
    const preset = this.mapPreset(presetRow as unknown as Record<string, unknown>)

    const daysResult = await this.db.execute({
      sql: 'SELECT * FROM preset_split_days WHERE preset_split_id = ? ORDER BY day_index',
      args: [presetId],
    })

    const days = await Promise.all(
      daysResult.rows.map(async (dayRow) => {
        const day = dayRow as unknown as Record<string, unknown>
        const dayId = day.id as number

        const musclesResult = await this.db.execute({
          sql: 'SELECT muscle_id FROM preset_split_day_muscles WHERE preset_split_day_id = ?',
          args: [dayId],
        })
        const targetMuscleIds = musclesResult.rows.map(r => (r as unknown as Record<string, unknown>).muscle_id as number)

        const exercisesResult = await this.db.execute({
          sql: 'SELECT * FROM preset_split_exercises WHERE preset_split_day_id = ? ORDER BY position',
          args: [dayId],
        })
        const exercises: PresetSplitExercise[] = exercisesResult.rows.map((exRow) => {
          const ex = exRow as unknown as Record<string, unknown>
          return {
            id: ex.id as number,
            presetSplitDayId: ex.preset_split_day_id as number,
            exerciseId: ex.exercise_id as string,
            position: ex.position as number,
            targetSets: ex.target_sets as number | null,
            targetReps: ex.target_reps as number | null,
            targetRpe: ex.target_rpe as number | null,
          }
        })

        return {
          id: dayId,
          presetSplitId: day.preset_split_id as number,
          name: day.name as string,
          dayIndex: day.day_index as number,
          location: day.location as DayLocation,
          targetMuscleIds,
          exercises,
        }
      }),
    )

    return { ...preset, days }
  }
}
```

**Step 3: Run to verify pass**

Run: `npx vitest run server/repositories/preset-split.repository.test.ts`
Expected: both pass.

**Step 4: Recommendation engine — write the failing test first (this is the part worth the most test scrutiny, since it's a scoring algorithm, not CRUD)**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { PresetSplitRepository } from '../repositories/preset-split.repository'
import { PresetSplitService } from './preset-split.service'
import type { RequestContext } from '../../shared/types/rbac.types'

describe('PresetSplitService.recommend', () => {
  let db: Client
  let service: PresetSplitService
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    const repo = new PresetSplitRepository(db)
    service = new PresetSplitService(ctx, repo)

    await repo.createWithDays({
      name: 'Full Body', description: null, frequencyMinDays: 2, frequencyMaxDays: 3,
      goal: 'general_fitness', experienceLevel: 'beginner', equipment: 'both', isPublished: true, days: [],
    })
    await repo.createWithDays({
      name: 'Upper/Lower', description: null, frequencyMinDays: 4, frequencyMaxDays: 4,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'gym', isPublished: true, days: [],
    })
    await repo.createWithDays({
      name: 'PPL', description: null, frequencyMinDays: 5, frequencyMaxDays: 6,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'gym', isPublished: true, days: [],
    })
    await repo.createWithDays({
      name: 'Unpublished Draft', description: null, frequencyMinDays: 5, frequencyMaxDays: 6,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'gym', isPublished: false, days: [],
    })
  })

  it('ranks an exact frequency + goal + experience + equipment match highest', async () => {
    const results = await service.recommend({
      daysPerWeek: 6, experienceLevel: 'intermediate', goal: 'muscle_gain', equipment: 'gym',
    })
    expect(results[0].preset.name).toBe('PPL')
    expect(results[0].score).toBe(9) // 3 (freq exact) + 2 (experience) + 2 (goal) + 2 (equipment)
  })

  it('gives partial credit for a frequency one day outside the range', async () => {
    const results = await service.recommend({
      daysPerWeek: 5, experienceLevel: 'intermediate', goal: 'muscle_gain', equipment: 'gym',
    })
    const upperLower = results.find(r => r.preset.name === 'Upper/Lower')!
    expect(upperLower.score).toBe(1 + 2 + 2 + 2) // 5 is one day outside [4,4]
  })

  it('never returns unpublished presets', async () => {
    const results = await service.recommend({ daysPerWeek: 6, experienceLevel: null, goal: null, equipment: null })
    expect(results.some(r => r.preset.name === 'Unpublished Draft')).toBe(false)
  })

  it('includes human-readable reasons for the top match', async () => {
    const results = await service.recommend({
      daysPerWeek: 3, experienceLevel: 'beginner', goal: 'general_fitness', equipment: 'home',
    })
    expect(results[0].preset.name).toBe('Full Body')
    expect(results[0].reasons.join(' ')).toMatch(/days/i)
  })
})
```

**Step 5: Run to verify failure**

Run: `npx vitest run server/services/preset-split.service.test.ts`
Expected: FAIL — `PresetSplitService` doesn't exist yet.

**Step 6: Implement `preset-split.service.ts`**

```ts
import { BaseService } from './base.service'
import { PresetSplitRepository, type CreatePresetSplitInput } from '../repositories/preset-split.repository'
import type { RequestContext } from '../../shared/types/rbac.types'
import type { PresetSplit, RecommendationInput, SplitRecommendation } from '../../shared/types/preset.types'

function frequencyScore(daysPerWeek: number, min: number, max: number): number {
  if (daysPerWeek >= min && daysPerWeek <= max) return 3
  const distance = daysPerWeek < min ? min - daysPerWeek : daysPerWeek - max
  return distance === 1 ? 1 : 0
}

function scorePreset(preset: PresetSplit, input: RecommendationInput): { score: number, reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  const freqScore = frequencyScore(input.daysPerWeek, preset.frequencyMinDays, preset.frequencyMaxDays)
  score += freqScore
  if (freqScore === 3) reasons.push(`fits your ${input.daysPerWeek} days/week`)
  else if (freqScore === 1) reasons.push(`close to your ${input.daysPerWeek} days/week`)

  if (input.experienceLevel && preset.experienceLevel === input.experienceLevel) {
    score += 2
    reasons.push(`matches your ${input.experienceLevel} experience`)
  }

  if (input.goal && preset.goal === input.goal) {
    score += 2
    reasons.push(`matches your ${input.goal.replace('_', ' ')} goal`)
  }

  if (input.equipment && (preset.equipment === input.equipment || preset.equipment === 'both')) {
    score += 2
    reasons.push(`works with your ${input.equipment} access`)
  }

  return { score, reasons }
}

export class PresetSplitService extends BaseService {
  constructor(ctx: RequestContext, private presets: PresetSplitRepository) {
    super(ctx)
  }

  async recommend(input: RecommendationInput): Promise<SplitRecommendation[]> {
    const published = await this.presets.findPublished()
    return published
      .map((preset) => {
        const { score, reasons } = scorePreset(preset, input)
        return { preset, score, reasons }
      })
      .sort((a, b) => b.score - a.score)
  }

  create(input: CreatePresetSplitInput) {
    this.requirePermission('preset:write')
    return this.presets.createWithDays(input)
  }

  getWithDays(presetId: number) {
    return this.presets.findWithDays(presetId)
  }
}
```

**Step 7: Run to verify pass**

Run: `npx vitest run server/services/preset-split.service.test.ts`
Expected: all 4 pass. If the exact-match score assertion (`9`) fails, double check `frequencyScore`'s boundary logic against the comment math in the test before changing the test — the test's inline arithmetic is the spec here.

---

## Task 13: Guided split creation — clone a preset into a real Block

**Files:**
- Modify: `server/services/split.service.ts`
- Test: `server/services/split.service.test.ts` (extend)

**Step 1: Write the failing test — the important assertion is that mutating the preset afterward does NOT affect the cloned block, since that's the "clone, don't reference" rule from the design doc**

Add to `server/services/split.service.test.ts`:

```ts
describe('SplitService.createFromPreset', () => {
  let db: Client
  let splitService: SplitService
  let presets: PresetSplitRepository
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    presets = new PresetSplitRepository(db)
    splitService = new SplitService(ctx, new BlockRepository(db))
  })

  it('materializes an independent block/days/exercises from a preset', async () => {
    const preset = await presets.createWithDays({
      name: 'PPL', description: null, frequencyMinDays: 6, frequencyMaxDays: 6,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'gym', isPublished: true,
      days: [{
        name: 'Push', dayIndex: 0, location: 'gym', targetMuscleIds: [],
        exercises: [{ exerciseId: 'bench-press', position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 }],
      }],
    })
    const presetWithDays = await presets.findWithDays(preset.id)

    const block = await splitService.createFromPreset(presetWithDays!, {
      name: 'My PPL', startDate: '2026-08-18', endDate: null,
    })

    const cloned = await splitService.getOwnedBlock(block.id)
    expect(cloned?.days[0].exercises[0].exerciseId).toBe('bench-press')
    expect(cloned?.userId).toBe('user-1')

    // Mutating the preset's exercise target afterward must not affect the clone.
    await db.execute({ sql: 'UPDATE preset_split_exercises SET target_reps = 999 WHERE preset_split_day_id = (SELECT id FROM preset_split_days WHERE preset_split_id = ?)', args: [preset.id] })
    const stillCloned = await splitService.getOwnedBlock(block.id)
    expect(stillCloned?.days[0].exercises[0].targetReps).toBe(8)
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run server/services/split.service.test.ts`
Expected: FAIL — `createFromPreset` doesn't exist.

**Step 3: Implement — add to `split.service.ts`**

```ts
import type { PresetSplitWithDays } from '../repositories/preset-split.repository'

// ...inside SplitService...

async createFromPreset(
  preset: PresetSplitWithDays,
  overrides: { name: string, startDate: string, endDate: string | null },
) {
  return this.blocks.createWithDays(this.ctx.userId, {
    programId: null,
    name: overrides.name,
    startDate: overrides.startDate,
    endDate: overrides.endDate,
    trainingDayMacroTarget: null,
    restDayMacroTarget: null,
    days: preset.days.map(day => ({
      name: day.name,
      dayOfWeek: day.dayIndex,
      location: day.location,
      exercises: day.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        position: ex.position,
        setType: 'weight_reps' as const,
        targetSets: ex.targetSets,
        targetReps: ex.targetReps,
        targetRpe: ex.targetRpe,
      })),
    })),
  })
}
```

Note the hardcoded `setType: 'weight_reps'` — presets don't store `set_type` (see the note in Task 3), so this needs the real exercise's nature to pick correctly. **Flag for follow-up**: once `ExerciseRepository` is wired in here, derive `setType` from the exercise's `category`/`force` (e.g. bodyweight-only equipment → `'bodyweight_reps'`) instead of defaulting every cloned exercise to `weight_reps`. Left as `weight_reps` for now because the guided-creation UI (not built in this plan) is expected to let the user confirm/adjust set type per exercise before saving, which makes this a reasonable, visible default rather than a silent bug — but note it in the follow-up list at the end of this plan.

**Step 4: Run to verify pass**

Run: `npx vitest run server/services/split.service.test.ts`
Expected: all pass, including the "mutating the preset doesn't affect the clone" assertion.

---

## Task 14: Gamification — XP ledger, streaks, achievements

**Files:**
- Create: `server/repositories/xp.repository.ts`
- Create: `server/repositories/streak.repository.ts`
- Create: `server/repositories/achievement.repository.ts`
- Create: `server/services/gamification.service.ts`
- Test: `server/repositories/xp.repository.test.ts`
- Test: `server/repositories/streak.repository.test.ts`
- Test: `server/services/gamification.service.test.ts`

**Step 1: XP ledger — failing test, idempotency is the behavior under test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { XpRepository } from './xp.repository'

describe('XpRepository', () => {
  let db: Client
  let repo: XpRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new XpRepository(db)
  })

  it('sums awarded xp for a user', async () => {
    await repo.award('user-1', 10, 'set_logged', 'set-1')
    await repo.award('user-1', 10, 'set_logged', 'set-2')
    expect(await repo.totalForUser('user-1')).toBe(20)
  })

  it('is idempotent: awarding the same source twice only counts once', async () => {
    await repo.award('user-1', 10, 'set_logged', 'set-1')
    await repo.award('user-1', 10, 'set_logged', 'set-1')
    expect(await repo.totalForUser('user-1')).toBe(10)
  })
})
```

**Step 2: Implement `xp.repository.ts`**

```ts
import type { Client } from '@libsql/client'
import type { XpSourceType } from '../../shared/types/gamification.types'

export class XpRepository {
  constructor(private db: Client) {}

  async award(userId: string, amount: number, sourceType: XpSourceType, sourceId: string): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO xp_ledger (user_id, amount, source_type, source_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id, source_type, source_id) DO NOTHING`,
      args: [userId, amount, sourceType, sourceId],
    })
  }

  async totalForUser(userId: string): Promise<number> {
    const result = await this.db.execute({
      sql: 'SELECT COALESCE(SUM(amount), 0) as total FROM xp_ledger WHERE user_id = ?',
      args: [userId],
    })
    return result.rows[0].total as number
  }
}
```

**Step 3: Run to verify pass**

Run: `npx vitest run server/repositories/xp.repository.test.ts`
Expected: both pass.

**Step 4: Streak repository — failing test for the plan-aware update logic**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { StreakRepository } from './streak.repository'

describe('StreakRepository', () => {
  let db: Client
  let repo: StreakRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new StreakRepository(db)
  })

  it('starts a streak at 1 on the first recorded active day', async () => {
    const streak = await repo.recordActiveDay('user-1', '2026-08-18')
    expect(streak.currentStreak).toBe(1)
    expect(streak.longestStreak).toBe(1)
  })

  it('increments on a later active day (does not need to be consecutive calendar days — week-scoped logic lives in the service)', async () => {
    await repo.recordActiveDay('user-1', '2026-08-18')
    const streak = await repo.recordActiveDay('user-1', '2026-08-19')
    expect(streak.currentStreak).toBe(2)
  })

  it('tracks the longest streak separately from a reset current streak', async () => {
    await repo.recordActiveDay('user-1', '2026-08-18')
    await repo.recordActiveDay('user-1', '2026-08-19')
    await repo.reset('user-1')
    const streak = await repo.recordActiveDay('user-1', '2026-09-01')
    expect(streak.currentStreak).toBe(1)
    expect(streak.longestStreak).toBe(2)
  })
})
```

**Step 5: Implement `streak.repository.ts`**

Deliberately dumb at the repository layer (`recordActiveDay` always increments; `reset` always zeroes) — the plan-aware "did they hit every scheduled day this week" decision belongs in `gamification.service.ts` (Step 8 below), which is what decides *when* to call `recordActiveDay` vs `reset`. This split keeps the repository a pure counter and the policy in one place.

```ts
import type { Client } from '@libsql/client'
import type { Streak } from '../../shared/types/gamification.types'

export class StreakRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): Streak {
    return {
      userId: row.user_id as string,
      currentStreak: row.current_streak as number,
      longestStreak: row.longest_streak as number,
      lastActiveDate: row.last_active_date as string | null,
    }
  }

  async findForUser(userId: string): Promise<Streak> {
    const result = await this.db.execute({ sql: 'SELECT * FROM streaks WHERE user_id = ?', args: [userId] })
    const row = result.rows[0]
    if (row) return this.mapRow(row as unknown as Record<string, unknown>)
    return { userId, currentStreak: 0, longestStreak: 0, lastActiveDate: null }
  }

  async recordActiveDay(userId: string, date: string): Promise<Streak> {
    const current = await this.findForUser(userId)
    const nextCurrent = current.currentStreak + 1
    const nextLongest = Math.max(current.longestStreak, nextCurrent)

    const result = await this.db.execute({
      sql: `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET
              current_streak = excluded.current_streak,
              longest_streak = excluded.longest_streak,
              last_active_date = excluded.last_active_date
            RETURNING *`,
      args: [userId, nextCurrent, nextLongest, date],
    })
    return this.mapRow(result.rows[0] as unknown as Record<string, unknown>)
  }

  async reset(userId: string): Promise<void> {
    const current = await this.findForUser(userId)
    await this.db.execute({
      sql: `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
            VALUES (?, 0, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET current_streak = 0`,
      args: [userId, current.longestStreak, current.lastActiveDate],
    })
  }
}
```

**Step 6: Run to verify pass**

Run: `npx vitest run server/repositories/streak.repository.test.ts`
Expected: all 3 pass.

**Step 7: `achievement.repository.ts`** (CRUD + unlock, no dedicated repository test — its logic is exercised through `gamification.service.test.ts` in Step 9, which is the layer with real behavior to verify):

```ts
import type { Client } from '@libsql/client'
import type { Achievement, AchievementCriteriaType } from '../../shared/types/gamification.types'

export interface CreateAchievementInput {
  key: string
  name: string
  description: string | null
  icon: string | null
  criteriaType: AchievementCriteriaType
  criteriaValue: Record<string, unknown>
  isPublished: boolean
}

export class AchievementRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): Achievement {
    return {
      id: row.id as number,
      key: row.key as string,
      name: row.name as string,
      description: row.description as string | null,
      icon: row.icon as string | null,
      criteriaType: row.criteria_type as AchievementCriteriaType,
      criteriaValue: JSON.parse(row.criteria_value as string),
      isPublished: Boolean(row.is_published),
    }
  }

  async create(input: CreateAchievementInput): Promise<Achievement> {
    const result = await this.db.execute({
      sql: `INSERT INTO achievements (key, name, description, icon, criteria_type, criteria_value, is_published)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [input.key, input.name, input.description, input.icon, input.criteriaType, JSON.stringify(input.criteriaValue), input.isPublished ? 1 : 0],
    })
    return this.mapRow(result.rows[0] as unknown as Record<string, unknown>)
  }

  async findPublished(): Promise<Achievement[]> {
    const result = await this.db.execute('SELECT * FROM achievements WHERE is_published = 1')
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }

  async findUnlockedKeys(userId: string): Promise<string[]> {
    const result = await this.db.execute({
      sql: `SELECT achievements.key FROM user_achievements
            JOIN achievements ON achievements.id = user_achievements.achievement_id
            WHERE user_achievements.user_id = ?`,
      args: [userId],
    })
    return result.rows.map(r => (r as unknown as Record<string, unknown>).key as string)
  }

  async unlock(userId: string, achievementId: number): Promise<void> {
    await this.db.execute({
      sql: 'INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
      args: [userId, achievementId],
    })
  }
}
```

**Step 8: `gamification.service.ts` — write the failing test first**

This is the orchestration layer: `evaluateAchievements` walks the published catalog and unlocks anything whose criteria is now met, given a small set of facts about the user (session count, current streak). The `criteria_type`/`criteria_value` dispatch is the extensibility point called out in the design doc.

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '../utils/test/create-test-db'
import { XpRepository } from '../repositories/xp.repository'
import { StreakRepository } from '../repositories/streak.repository'
import { AchievementRepository } from '../repositories/achievement.repository'
import { GamificationService } from './gamification.service'

describe('GamificationService', () => {
  let db: Client
  let service: GamificationService
  let achievements: AchievementRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    achievements = new AchievementRepository(db)
    service = new GamificationService(
      new XpRepository(db),
      new StreakRepository(db),
      achievements,
    )
  })

  it('awards xp for a logged set', async () => {
    await service.onSetLogged('user-1', 'set-1')
    expect(await new XpRepository(db).totalForUser('user-1')).toBeGreaterThan(0)
  })

  it('unlocks a streak_length achievement once the streak reaches its threshold', async () => {
    await achievements.create({
      key: 'week-streak', name: '7-Day Streak', description: null, icon: null,
      criteriaType: 'streak_length', criteriaValue: { days: 2 }, isPublished: true,
    })

    await service.onSessionCompleted('user-1', 'session-1', { scheduledDaysThisWeek: 5, completedDaysThisWeek: 1 })
    let unlocked = await achievements.findUnlockedKeys('user-1')
    expect(unlocked).not.toContain('week-streak')

    await service.onSessionCompleted('user-1', 'session-2', { scheduledDaysThisWeek: 5, completedDaysThisWeek: 2 })
    unlocked = await achievements.findUnlockedKeys('user-1')
    expect(unlocked).toContain('week-streak')
  })

  it('does not increment the streak when a scheduled day was missed', async () => {
    await service.onSessionCompleted('user-1', 'session-1', { scheduledDaysThisWeek: 5, completedDaysThisWeek: 1, missedScheduledDay: true })
    const streak = await new StreakRepository(db).findForUser('user-1')
    expect(streak.currentStreak).toBe(0)
  })
})
```

**Step 9: Implement `gamification.service.ts`**

```ts
import { XpRepository } from '../repositories/xp.repository'
import { StreakRepository } from '../repositories/streak.repository'
import { AchievementRepository } from '../repositories/achievement.repository'

const XP_PER_SET = 10
const XP_SESSION_COMPLETE_BONUS = 25
const XP_PR_BONUS = 50

export interface SessionCompletionFacts {
  scheduledDaysThisWeek: number
  completedDaysThisWeek: number
  missedScheduledDay?: boolean
}

export class GamificationService {
  constructor(
    private xp: XpRepository,
    private streaks: StreakRepository,
    private achievements: AchievementRepository,
  ) {}

  async onSetLogged(userId: string, setId: string): Promise<void> {
    await this.xp.award(userId, XP_PER_SET, 'set_logged', setId)
  }

  async onPrHit(userId: string, prId: string): Promise<void> {
    await this.xp.award(userId, XP_PR_BONUS, 'pr', prId)
    await this.evaluateAchievements(userId)
  }

  async onSessionCompleted(userId: string, sessionId: string, facts: SessionCompletionFacts): Promise<void> {
    await this.xp.award(userId, XP_SESSION_COMPLETE_BONUS, 'session_completed', sessionId)

    if (facts.missedScheduledDay) {
      await this.streaks.reset(userId)
    } else if (facts.completedDaysThisWeek === facts.scheduledDaysThisWeek) {
      await this.streaks.recordActiveDay(userId, new Date().toISOString().slice(0, 10))
    }

    await this.evaluateAchievements(userId)
  }

  private async evaluateAchievements(userId: string): Promise<void> {
    const [published, unlockedKeys, streak] = await Promise.all([
      this.achievements.findPublished(),
      this.achievements.findUnlockedKeys(userId),
      this.streaks.findForUser(userId),
    ])

    for (const achievement of published) {
      if (unlockedKeys.includes(achievement.key)) continue

      let met = false
      if (achievement.criteriaType === 'streak_length') {
        const threshold = achievement.criteriaValue.days as number
        met = streak.currentStreak >= threshold
      }
      // 'session_count', 'pr', 'target_hit' criteria types are defined in the
      // shared type but have no evaluator wired here yet — there's no
      // WorkoutSession/Set data source to check them against until that
      // domain exists (see plan header). Add branches here when it does.

      if (met) {
        await this.achievements.unlock(userId, achievement.id)
      }
    }
  }
}
```

**Step 10: Run to verify pass**

Run: `npx vitest run server/services/gamification.service.test.ts`
Expected: all 3 pass.

---

## Task 15: Seed data — roles, starter achievements, three preset splits

**Files:**
- Modify: `server/database/seed.ts`

**Step 1: Extend `seed.ts`**

Add after the existing exercise-seeding loop (before `console.log('Done.')`), using the repositories built above instead of hand-rolled SQL, so this seed script is itself a real usage example of the layer this plan builds:

```ts
import { RoleRepository } from '../repositories/role.repository'
import { PresetSplitRepository } from '../repositories/preset-split.repository'
import { AchievementRepository } from '../repositories/achievement.repository'
```

(add to the top imports, alongside the existing ones)

```ts
console.log('Seeding roles...')
const roles = new RoleRepository(db)
const existingAdmin = await roles.findByKey('admin')
if (!existingAdmin) {
  await roles.insert({ key: 'admin', name: 'Admin', permissions: ['preset:write', 'achievement:write', 'role:write'] })
  await roles.insert({ key: 'member', name: 'Member', permissions: [] })
}

console.log('Seeding starter achievements...')
const achievements = new AchievementRepository(db)
const starterAchievements = [
  { key: 'first_session', name: 'First Session Logged', description: 'Logged your first workout session.', icon: '🎉', criteriaType: 'session_count' as const, criteriaValue: { count: 1 }, isPublished: true },
  { key: 'week_streak', name: '7-Day Streak', description: 'Hit every scheduled day for a week straight.', icon: '🔥', criteriaType: 'streak_length' as const, criteriaValue: { days: 1 }, isPublished: true },
  { key: 'month_streak', name: '30-Day Streak', description: 'A full month of hitting every scheduled day.', icon: '🏆', criteriaType: 'streak_length' as const, criteriaValue: { days: 4 }, isPublished: true },
  { key: 'first_pr', name: 'First PR', description: 'Logged your first personal record.', icon: '💪', criteriaType: 'pr' as const, criteriaValue: {}, isPublished: true },
  { key: 'first_target_hit', name: 'Goal Reached', description: 'Hit one of your targets.', icon: '🎯', criteriaType: 'target_hit' as const, criteriaValue: {}, isPublished: true },
]
for (const achievement of starterAchievements) {
  await achievements.create(achievement).catch(() => {
    /* already seeded (unique key constraint) — fine on re-run */
  })
}

console.log('Seeding preset splits...')
const presetSplits = new PresetSplitRepository(db)
const findExercise = async (name: string) => {
  const result = await db.execute({ sql: 'SELECT id FROM exercises WHERE name = ? LIMIT 1', args: [name] })
  return result.rows[0]?.id as string | undefined
}
const findMuscle = async (name: string) => {
  const result = await db.execute({ sql: 'SELECT id FROM muscles WHERE name = ? LIMIT 1', args: [name] })
  return result.rows[0]?.id as number | undefined
}

const benchPress = await findExercise('Barbell Bench Press')
const chest = await findMuscle('chest')
// ...look up whichever real names exist in gym_exercises.json for a small
// representative exercise list per day; the exact names must be checked
// against the seeded data since free-exercise-db naming isn't always the
// obvious phrase (e.g. confirm with:
//   SELECT name FROM exercises WHERE name LIKE '%Bench Press%';
// before hardcoding names here).

if (benchPress && chest) {
  await presetSplits.createWithDays({
    name: 'Full Body',
    description: 'Great for 2-3 days/week — hits everything each session.',
    frequencyMinDays: 2, frequencyMaxDays: 3,
    goal: 'general_fitness', experienceLevel: 'beginner', equipment: 'both', isPublished: true,
    days: [
      { name: 'Full Body A', dayIndex: 0, location: 'gym', targetMuscleIds: [chest], exercises: [{ exerciseId: benchPress, position: 0, targetSets: 3, targetReps: 10, targetRpe: 7 }] },
    ],
  }).catch(() => {})
  // Repeat createWithDays calls for 'Upper/Lower' (4 days/week) and
  // 'Push Pull Legs' (5-6 days/week) using the same lookup pattern —
  // this task's job is establishing the pattern; filling in a fuller
  // exercise list per preset is straightforward repetition of the above
  // and is a good candidate to hand to a fresh subagent per preset.
}
```

**Step 2: Verify names against the real seed data before hardcoding more of them**

Run: `node -e "const d = require('./gym_exercises.json'); console.log(d.exercises.filter(e => /bench press/i.test(e.name)).map(e => e.name))"`

Use this pattern to confirm every exercise name referenced in the seed extension actually exists before running the full seed — a typo'd name silently seeds a preset day with zero exercises (the `if (benchPress && chest)` guard prevents a crash but not a quietly-empty preset, so check output, don't just trust the guard).

**Step 3: Run the seed script against a real or scratch Turso DB**

Run: `npm run db:seed`
Expected: `Seeding roles...`, `Seeding starter achievements...`, `Seeding preset splits...`, then `Done.`, no errors.

**Step 4: Spot-check**

Run: `npx tsx -e "
import { createClient } from '@libsql/client'
const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! })
const roles = await db.execute('SELECT key FROM roles')
console.log(roles.rows)
"`
Expected: rows for `admin` and `member`.

---

## Task 16: API routes wiring the flows together

**Files:**
- Create: `server/utils/get-request-context.ts`
- Create: `server/api/profile/index.get.ts`
- Create: `server/api/profile/onboarding.post.ts`
- Create: `server/api/body-metrics/index.post.ts`
- Create: `server/api/preset-splits/recommend.get.ts`
- Create: `server/api/preset-splits/index.post.ts`
- Create: `server/api/blocks/index.post.ts`
- Create: `server/api/blocks/from-preset.post.ts`

No new unit tests here — these are thin Nitro handlers whose only job is request parsing + wiring to the already-tested services, verified via the manual curl checks in Step-by-step below rather than vitest (there's no HTTP test harness in this project yet, and building one is out of scope for this plan).

**Step 1: `server/utils/get-request-context.ts`**

```ts
import type { H3Event } from 'h3'
import { createError, getHeader } from 'h3'
import { useDb } from './db'
import { buildRequestContext } from './build-request-context'
import type { RequestContext } from '../../shared/types/rbac.types'

// TODO(auth): replace this header read with real session/auth-derived userId
// once auth is wired up. Every route using this function inherits the TODO.
export async function getRequestContext(event: H3Event): Promise<RequestContext> {
  const userId = getHeader(event, 'x-user-id')
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'Missing x-user-id header' })
  }
  return buildRequestContext(useDb(), userId)
}
```

**Step 2: `server/api/profile/onboarding.post.ts`**

```ts
import { readBody } from 'h3'
import { useDb } from '../../utils/db'
import { getRequestContext } from '../../utils/get-request-context'
import { ProfileRepository } from '../../repositories/profile.repository'
import { BodyMetricsRepository } from '../../repositories/body-metrics.repository'
import { ProfileService } from '../../services/profile.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db))
  await service.completeOnboarding(body)
  return service.getProfile()
})
```

**Step 3: `server/api/profile/index.get.ts`**

```ts
import { useDb } from '../../utils/db'
import { getRequestContext } from '../../utils/get-request-context'
import { ProfileRepository } from '../../repositories/profile.repository'
import { BodyMetricsRepository } from '../../repositories/body-metrics.repository'
import { ProfileService } from '../../services/profile.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db))
  return { profile: await service.getProfile(), stats: await service.getComputedStats() }
})
```

**Step 4: `server/api/body-metrics/index.post.ts`**

```ts
import { readBody } from 'h3'
import { useDb } from '../../utils/db'
import { getRequestContext } from '../../utils/get-request-context'
import { BodyMetricsRepository } from '../../repositories/body-metrics.repository'
import { BodyMetricsService } from '../../services/body-metrics.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const service = new BodyMetricsService(ctx, new BodyMetricsRepository(useDb()))
  return service.record(body)
})
```

**Step 5: `server/api/preset-splits/recommend.get.ts`**

```ts
import { getQuery } from 'h3'
import { useDb } from '../../utils/db'
import { getRequestContext } from '../../utils/get-request-context'
import { PresetSplitRepository } from '../../repositories/preset-split.repository'
import { PresetSplitService } from '../../services/preset-split.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const query = getQuery(event)
  const service = new PresetSplitService(ctx, new PresetSplitRepository(useDb()))
  return service.recommend({
    daysPerWeek: Number(query.daysPerWeek),
    experienceLevel: (query.experienceLevel as never) ?? null,
    goal: (query.goal as never) ?? null,
    equipment: (query.equipment as never) ?? null,
  })
})
```

**Step 6: `server/api/preset-splits/index.post.ts`** (admin-only, enforced by `PresetSplitService.create`'s `requirePermission` call from Task 12)

```ts
import { readBody } from 'h3'
import { useDb } from '../../utils/db'
import { getRequestContext } from '../../utils/get-request-context'
import { PresetSplitRepository } from '../../repositories/preset-split.repository'
import { PresetSplitService } from '../../services/preset-split.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const service = new PresetSplitService(ctx, new PresetSplitRepository(useDb()))
  return service.create(body)
})
```

**Step 7: `server/api/blocks/index.post.ts`** (from scratch)

```ts
import { readBody } from 'h3'
import { useDb } from '../../utils/db'
import { getRequestContext } from '../../utils/get-request-context'
import { BlockRepository } from '../../repositories/block.repository'
import { SplitService } from '../../services/split.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const service = new SplitService(ctx, new BlockRepository(useDb()))
  return service.createFromScratch(body)
})
```

**Step 8: `server/api/blocks/from-preset.post.ts`**

```ts
import { readBody } from 'h3'
import { useDb } from '../../utils/db'
import { getRequestContext } from '../../utils/get-request-context'
import { BlockRepository } from '../../repositories/block.repository'
import { PresetSplitRepository } from '../../repositories/preset-split.repository'
import { SplitService } from '../../services/split.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { presetSplitId: number, name: string, startDate: string, endDate: string | null }
  const db = useDb()

  const preset = await new PresetSplitRepository(db).findWithDays(body.presetSplitId)
  if (!preset) {
    throw createError({ statusCode: 404, statusMessage: 'Preset not found' })
  }

  const service = new SplitService(ctx, new BlockRepository(db))
  return service.createFromPreset(preset, { name: body.name, startDate: body.startDate, endDate: body.endDate })
})
```

**Step 9: Manual smoke test (no auth exists yet, so this uses the `x-user-id` placeholder header)**

Run: `npm run dev` in one terminal, then in another:

```bash
# Create a user directly (no signup flow exists yet)
npx tsx -e "
import { createClient } from '@libsql/client'
const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! })
await db.execute({ sql: 'INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)', args: ['smoke-user', 'smoke@example.com'] })
"

curl -s -X POST http://localhost:3000/api/profile/onboarding \
  -H 'content-type: application/json' -H 'x-user-id: smoke-user' \
  -d '{"dateOfBirth":"1995-06-15","gender":"male","heightCm":178,"weightKg":75,"activityLevel":"moderately_active"}'

curl -s http://localhost:3000/api/profile -H 'x-user-id: smoke-user'

curl -s 'http://localhost:3000/api/preset-splits/recommend?daysPerWeek=3&experienceLevel=beginner&goal=general_fitness&equipment=both' \
  -H 'x-user-id: smoke-user'
```

Expected: each call returns JSON, no 500s. The onboarding response includes `heightCm: 178`; the profile GET includes a `stats.bmi` around 23.7 and a `stats.tdee` in the 2000s; the recommend call returns the seeded "Full Body" preset first.

---

## Follow-ups intentionally deferred (not part of this plan)

- Wrap `BlockRepository.createWithDays` / `PresetSplitRepository.createWithDays` in a real `db.batch(...)` transaction before pointing this at a production Turso instance (flagged in Task 11).
- Derive `SplitExercise.setType` from the underlying `Exercise` instead of hardcoding `'weight_reps'` on preset clone (flagged in Task 13).
- Wire `GamificationService`'s `session_count`, `pr`, and `target_hit` achievement criteria once `WorkoutSession`/`Set` exist (flagged in Task 14).
- Fill out the seeded preset catalog beyond the one representative "Full Body" day built in Task 15 — Upper/Lower and PPL need their own exercise lists checked against real names in `gym_exercises.json`.
- Auth itself: every route in Task 16 uses an `x-user-id` header placeholder, marked `TODO(auth)`.
- Admin UI for managing presets/achievements — the service-level permission checks exist; no screens are built here.
