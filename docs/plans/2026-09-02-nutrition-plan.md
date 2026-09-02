# Nutrition Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a user log meals built from a personal ingredient catalog (macros auto-calculated from quantity, like their old Excel sheet), save/reuse preset meals, set a standalone daily macro target, and see today's totals vs. target on the home page and on a dedicated `/nutrition` page.

**Architecture:** Follows the existing repository → service → h3 API route → Pinia Colada composable → Vue page/component layering used by hydration and body-metrics. Five new tables (`ingredients`, `meal_logs`, `meal_log_items`, `preset_meals`, `preset_meal_items`) plus four new columns on `user_profiles`. No new auth/RBAC concepts — everything is scoped to `ctx.userId` exactly like hydration and body metrics (no `requirePermission` calls needed, these are personal records).

**Tech Stack:** Nuxt 4, @libsql/client (raw SQL, no ORM), h3, Pinia Colada, Vitest, Tailwind.

**Design doc:** `docs/plans/2026-09-02-nutrition-design.md`

---

## Key design decisions carried into code

- **Macro calc:** `scale = unitType === 'weight_100g' ? quantity / 100 : quantity`; each macro = `ingredient.macro * scale`. Computed server-side in `NutritionService`.
- **Snapshotting:** `meal_log_items` stores the computed macros *and* the ingredient name at log time, not a live join — editing an ingredient later never rewrites past totals.
- **Remaining is signed, not clamped:** unlike hydration's `Math.max(0, ...)`, nutrition's `remaining = target - totals` can go negative. The user explicitly wants to know when they're *over* target, not just "0 remaining."
- **Daily target is standalone:** stored as 4 nullable columns on `user_profiles` (`nutrition_target_calories/protein_g/carbs_g/fat_g`), exposed by `ProfileRepository` as a single nested `nutritionTarget: MacroTarget | null` (null unless all 4 are set, which is guaranteed since they're always written together).

---

## Task 1: Schema + shared types

**Files:**
- Modify: `server/database/schema.sql`
- Modify: `shared/types/profile.types.ts`
- Create: `shared/types/nutrition.types.ts`

**Step 1: Add tables to schema.sql**

Append to the end of `server/database/schema.sql`:

```sql
-- Nutrition: personal ingredient catalog + logged meals + reusable preset meals.
-- Mirrors hydration_logs' "one row per event" shape, but a meal is a list of
-- ingredient lines rather than a single scalar, so it gets a two-table
-- log/log_items split like workout_sessions/exercise_logs.

CREATE TABLE IF NOT EXISTS ingredients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  unit_type   TEXT NOT NULL CHECK (unit_type IN ('weight_100g', 'count')),
  unit_label  TEXT,               -- e.g. 'cup', 'can', 'scoop'; null when unit_type = 'weight_100g'
  calories    REAL NOT NULL,      -- per 100g if weight_100g, per 1 unit_label if count
  protein_g   REAL NOT NULL,
  carbs_g     REAL NOT NULL,
  fat_g       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS meal_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT,
  logged_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ingredient_name/calories/protein_g/carbs_g/fat_g are a snapshot computed at
-- log time (quantity scaled against the ingredient's macros then), not a live
-- join -- editing an ingredient later must not rewrite past totals.
CREATE TABLE IF NOT EXISTS meal_log_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_log_id      INTEGER NOT NULL REFERENCES meal_logs(id) ON DELETE CASCADE,
  ingredient_id    INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  ingredient_name  TEXT NOT NULL,
  quantity         REAL NOT NULL,
  calories         REAL NOT NULL,
  protein_g        REAL NOT NULL,
  carbs_g          REAL NOT NULL,
  fat_g            REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS preset_meals (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preset_meal_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_meal_id  INTEGER NOT NULL REFERENCES preset_meals(id) ON DELETE CASCADE,
  ingredient_id   INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity        REAL NOT NULL
);

ALTER TABLE user_profiles ADD COLUMN nutrition_target_calories REAL;
ALTER TABLE user_profiles ADD COLUMN nutrition_target_protein_g REAL;
ALTER TABLE user_profiles ADD COLUMN nutrition_target_carbs_g REAL;
ALTER TABLE user_profiles ADD COLUMN nutrition_target_fat_g REAL;

CREATE INDEX IF NOT EXISTS idx_ingredients_user       ON ingredients(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_logs_user          ON meal_logs(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_meal_log_items_meal     ON meal_log_items(meal_log_id);
CREATE INDEX IF NOT EXISTS idx_preset_meals_user       ON preset_meals(user_id);
CREATE INDEX IF NOT EXISTS idx_preset_meal_items_meal  ON preset_meal_items(preset_meal_id);
```

Note: `createTestDb` (`server/utils/test/create-test-db.ts`) already tolerates "duplicate column name" errors on re-run, so appending `ALTER TABLE` statements here is safe and matches how `hydration_target_ml` etc. were added.

**Step 2: Add `nutrition.types.ts`**

```typescript
import type { MacroTarget } from './split.types'

export type IngredientUnitType = 'weight_100g' | 'count'

export interface Ingredient {
  id: number
  userId: string
  name: string
  unitType: IngredientUnitType
  unitLabel: string | null
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface MealLogItem {
  id: number
  mealLogId: number
  ingredientId: number | null
  ingredientName: string
  quantity: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface MealLog {
  id: number
  userId: string
  name: string | null
  loggedAt: string
  items: MealLogItem[]
}

export interface PresetMealItem {
  id: number
  presetMealId: number
  ingredientId: number
  quantity: number
}

export interface PresetMeal {
  id: number
  userId: string
  name: string
  items: PresetMealItem[]
}

export interface NutritionToday {
  totals: MacroTarget
  target: MacroTarget | null
  remaining: MacroTarget | null
  meals: MealLog[]
}
```

**Step 3: Add `nutritionTarget` to `UserProfile`**

In `shared/types/profile.types.ts`, add the import and field:

```typescript
import type { MacroTarget } from './split.types'
```

Add to the `UserProfile` interface, after `hydrationLastRemindedAt`:

```typescript
  nutritionTarget: MacroTarget | null
```

**Step 4: Commit**

```bash
git add server/database/schema.sql shared/types/profile.types.ts shared/types/nutrition.types.ts
git commit -m "feat(nutrition): add schema and shared types"
```

---

## Task 2: `IngredientRepository`

**Files:**
- Create: `server/repositories/ingredient.repository.ts`
- Test: `tests/server/repositories/ingredient.repository.test.ts`

**Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'

describe('IngredientRepository', () => {
  let db: Client
  let repo: IngredientRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    repo = new IngredientRepository(db)
  })

  const chicken = {
    name: 'Chicken breast',
    unitType: 'weight_100g' as const,
    unitLabel: null,
    calories: 165,
    proteinG: 31,
    carbsG: 0,
    fatG: 3.6,
  }

  it('creates an ingredient and reads it back', async () => {
    const created = await repo.create('user-1', chicken)
    expect(created.id).toBeGreaterThan(0)

    const found = await repo.findById(created.id, 'user-1')
    expect(found).toMatchObject(chicken)
  })

  it('lists only the caller\'s ingredients, alphabetically', async () => {
    await repo.create('user-1', { ...chicken, name: 'Rice' })
    await repo.create('user-1', { ...chicken, name: 'Chicken breast' })
    await repo.create('user-2', { ...chicken, name: 'Other user ingredient' })

    const list = await repo.findAllForUser('user-1')
    expect(list.map(i => i.name)).toEqual(['Chicken breast', 'Rice'])
  })

  it('does not find another user\'s ingredient by id', async () => {
    const created = await repo.create('user-1', chicken)
    expect(await repo.findById(created.id, 'user-2')).toBeNull()
  })

  it('updates only the provided fields', async () => {
    const created = await repo.create('user-1', chicken)
    const updated = await repo.update(created.id, 'user-1', { calories: 200 })
    expect(updated).toMatchObject({ ...chicken, calories: 200 })
  })

  it('does not update another user\'s ingredient', async () => {
    const created = await repo.create('user-1', chicken)
    const updated = await repo.update(created.id, 'user-2', { calories: 200 })
    expect(updated).toBeNull()
  })

  it('deletes only the caller\'s own ingredient', async () => {
    const created = await repo.create('user-1', chicken)
    await repo.delete(created.id, 'user-2')
    expect(await repo.findById(created.id, 'user-1')).not.toBeNull()

    await repo.delete(created.id, 'user-1')
    expect(await repo.findById(created.id, 'user-1')).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/ingredient.repository.test.ts`
Expected: FAIL — `Cannot find module '~~/server/repositories/ingredient.repository'`

**Step 3: Write the implementation**

```typescript
import type { Client } from '@libsql/client'
import type { Ingredient, IngredientUnitType } from '~~/shared/types/nutrition.types'

export interface CreateIngredientInput {
  name: string
  unitType: IngredientUnitType
  unitLabel: string | null
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export type UpdateIngredientInput = Partial<CreateIngredientInput>

const COLUMN_FOR: Record<keyof CreateIngredientInput, string> = {
  name: 'name',
  unitType: 'unit_type',
  unitLabel: 'unit_label',
  calories: 'calories',
  proteinG: 'protein_g',
  carbsG: 'carbs_g',
  fatG: 'fat_g',
}

export class IngredientRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): Ingredient {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      name: row.name as string,
      unitType: row.unit_type as IngredientUnitType,
      unitLabel: row.unit_label as string | null,
      calories: row.calories as number,
      proteinG: row.protein_g as number,
      carbsG: row.carbs_g as number,
      fatG: row.fat_g as number,
    }
  }

  async create(userId: string, input: CreateIngredientInput): Promise<Ingredient> {
    const result = await this.db.execute({
      sql: `INSERT INTO ingredients (user_id, name, unit_type, unit_label, calories, protein_g, carbs_g, fat_g)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [userId, input.name, input.unitType, input.unitLabel, input.calories, input.proteinG, input.carbsG, input.fatG],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to create ingredient')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }

  async findAllForUser(userId: string): Promise<Ingredient[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM ingredients WHERE user_id = ? ORDER BY name', args: [userId] })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }

  async findById(id: number, userId: string): Promise<Ingredient | null> {
    const result = await this.db.execute({ sql: 'SELECT * FROM ingredients WHERE id = ? AND user_id = ?', args: [id, userId] })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async update(id: number, userId: string, input: UpdateIngredientInput): Promise<Ingredient | null> {
    const entries = (Object.entries(input) as [keyof CreateIngredientInput, unknown][]).filter(([, v]) => v !== undefined)
    if (!entries.length) return this.findById(id, userId)

    const sql = `UPDATE ingredients SET ${entries.map(([k]) => `${COLUMN_FOR[k]} = ?`).join(', ')} WHERE id = ? AND user_id = ? RETURNING *`
    const result = await this.db.execute({ sql, args: [...entries.map(([, v]) => v as never), id, userId] })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async delete(id: number, userId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM ingredients WHERE id = ? AND user_id = ?', args: [id, userId] })
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/ingredient.repository.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add server/repositories/ingredient.repository.ts tests/server/repositories/ingredient.repository.test.ts
git commit -m "feat(nutrition): add IngredientRepository"
```

---

## Task 3: `MealLogRepository`

**Files:**
- Create: `server/repositories/meal-log.repository.ts`
- Test: `tests/server/repositories/meal-log.repository.test.ts`

**Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { MealLogRepository, type MealLogItemInput } from '~~/server/repositories/meal-log.repository'
import { toSqliteDatetime } from '~~/server/utils/date'

describe('MealLogRepository', () => {
  let db: Client
  let repo: MealLogRepository

  const chickenItem: MealLogItemInput = {
    ingredientId: 1,
    ingredientName: 'Chicken breast',
    quantity: 150,
    calories: 247.5,
    proteinG: 46.5,
    carbsG: 0,
    fatG: 5.4,
  }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({
      sql: `INSERT INTO ingredients (id, user_id, name, unit_type, calories, protein_g, carbs_g, fat_g)
            VALUES (1, 'user-1', 'Chicken breast', 'weight_100g', 165, 31, 0, 3.6)`,
    })
    repo = new MealLogRepository(db)
  })

  it('logs a meal with its items and reads it back', async () => {
    const log = await repo.log('user-1', 'Lunch', [chickenItem])
    expect(log.name).toBe('Lunch')
    expect(log.items).toHaveLength(1)
    expect(log.items[0]).toMatchObject(chickenItem)
  })

  it('finds meals logged within a date range', async () => {
    await db.execute({
      sql: 'INSERT INTO meal_logs (user_id, name, logged_at) VALUES (?, ?, ?)',
      args: ['user-1', 'Yesterday', toSqliteDatetime(new Date('2026-08-01T12:00:00Z'))],
    })
    await repo.log('user-1', 'Today', [chickenItem])

    const results = await repo.findForRange(
      'user-1',
      toSqliteDatetime(new Date('2026-08-02T00:00:00Z')),
      toSqliteDatetime(new Date('2026-08-03T00:00:00Z')),
    )
    expect(results).toHaveLength(0)
  })

  it('deletes only the caller\'s own meal log', async () => {
    const log = await repo.log('user-1', 'Lunch', [chickenItem])
    await repo.delete(log.id, 'user-2')
    expect(await repo.findForRange('user-1', '2020-01-01 00:00:00', '2999-01-01 00:00:00')).toHaveLength(1)

    await repo.delete(log.id, 'user-1')
    expect(await repo.findForRange('user-1', '2020-01-01 00:00:00', '2999-01-01 00:00:00')).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/meal-log.repository.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
import type { Client } from '@libsql/client'
import type { MealLog, MealLogItem } from '~~/shared/types/nutrition.types'

export interface MealLogItemInput {
  ingredientId: number
  ingredientName: string
  quantity: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export class MealLogRepository {
  constructor(private db: Client) {}

  private mapLog(row: Record<string, unknown>): Omit<MealLog, 'items'> {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      name: row.name as string | null,
      loggedAt: row.logged_at as string,
    }
  }

  private mapItem(row: Record<string, unknown>): MealLogItem {
    return {
      id: row.id as number,
      mealLogId: row.meal_log_id as number,
      ingredientId: row.ingredient_id as number | null,
      ingredientName: row.ingredient_name as string,
      quantity: row.quantity as number,
      calories: row.calories as number,
      proteinG: row.protein_g as number,
      carbsG: row.carbs_g as number,
      fatG: row.fat_g as number,
    }
  }

  private async loadItems(mealLogId: number): Promise<MealLogItem[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM meal_log_items WHERE meal_log_id = ?', args: [mealLogId] })
    return result.rows.map(row => this.mapItem(row as unknown as Record<string, unknown>))
  }

  async log(userId: string, name: string | null, items: MealLogItemInput[]): Promise<MealLog> {
    const result = await this.db.execute({
      sql: 'INSERT INTO meal_logs (user_id, name) VALUES (?, ?) RETURNING *',
      args: [userId, name],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to log meal')
    const mealLog = this.mapLog(row as unknown as Record<string, unknown>)

    for (const item of items) {
      await this.db.execute({
        sql: `INSERT INTO meal_log_items (meal_log_id, ingredient_id, ingredient_name, quantity, calories, protein_g, carbs_g, fat_g)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [mealLog.id, item.ingredientId, item.ingredientName, item.quantity, item.calories, item.proteinG, item.carbsG, item.fatG],
      })
    }

    return { ...mealLog, items: await this.loadItems(mealLog.id) }
  }

  async findForRange(userId: string, startIso: string, endIso: string): Promise<MealLog[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM meal_logs WHERE user_id = ? AND logged_at >= ? AND logged_at < ? ORDER BY logged_at',
      args: [userId, startIso, endIso],
    })
    const logs = result.rows.map(row => this.mapLog(row as unknown as Record<string, unknown>))
    return Promise.all(logs.map(async log => ({ ...log, items: await this.loadItems(log.id) })))
  }

  async delete(id: number, userId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM meal_logs WHERE id = ? AND user_id = ?', args: [id, userId] })
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/meal-log.repository.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add server/repositories/meal-log.repository.ts tests/server/repositories/meal-log.repository.test.ts
git commit -m "feat(nutrition): add MealLogRepository"
```

---

## Task 4: `PresetMealRepository`

**Files:**
- Create: `server/repositories/preset-meal.repository.ts`
- Test: `tests/server/repositories/preset-meal.repository.test.ts`

**Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'

describe('PresetMealRepository', () => {
  let db: Client
  let repo: PresetMealRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({
      sql: `INSERT INTO ingredients (id, user_id, name, unit_type, calories, protein_g, carbs_g, fat_g)
            VALUES (1, 'user-1', 'Chicken breast', 'weight_100g', 165, 31, 0, 3.6)`,
    })
    repo = new PresetMealRepository(db)
  })

  it('creates a preset with items and reads it back', async () => {
    const preset = await repo.create('user-1', { name: 'Post-workout', items: [{ ingredientId: 1, quantity: 200 }] })
    expect(preset.name).toBe('Post-workout')
    expect(preset.items).toEqual([{ id: expect.any(Number), presetMealId: preset.id, ingredientId: 1, quantity: 200 }])
  })

  it('lists only the caller\'s presets, alphabetically, with items', async () => {
    await repo.create('user-1', { name: 'Snack', items: [{ ingredientId: 1, quantity: 50 }] })
    await repo.create('user-1', { name: 'Breakfast', items: [{ ingredientId: 1, quantity: 100 }] })

    const list = await repo.findAllForUser('user-1')
    expect(list.map(p => p.name)).toEqual(['Breakfast', 'Snack'])
    expect(list[0]?.items).toHaveLength(1)
  })

  it('does not find another user\'s preset by id', async () => {
    const preset = await repo.create('user-1', { name: 'Snack', items: [{ ingredientId: 1, quantity: 50 }] })
    expect(await repo.findById(preset.id, 'user-2')).toBeNull()
  })

  it('deletes only the caller\'s own preset', async () => {
    const preset = await repo.create('user-1', { name: 'Snack', items: [{ ingredientId: 1, quantity: 50 }] })
    await repo.delete(preset.id, 'user-2')
    expect(await repo.findById(preset.id, 'user-1')).not.toBeNull()

    await repo.delete(preset.id, 'user-1')
    expect(await repo.findById(preset.id, 'user-1')).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/preset-meal.repository.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
import type { Client } from '@libsql/client'
import type { PresetMeal, PresetMealItem } from '~~/shared/types/nutrition.types'

export interface CreatePresetMealInput {
  name: string
  items: { ingredientId: number, quantity: number }[]
}

export class PresetMealRepository {
  constructor(private db: Client) {}

  private mapPreset(row: Record<string, unknown>): Omit<PresetMeal, 'items'> {
    return { id: row.id as number, userId: row.user_id as string, name: row.name as string }
  }

  private mapItem(row: Record<string, unknown>): PresetMealItem {
    return {
      id: row.id as number,
      presetMealId: row.preset_meal_id as number,
      ingredientId: row.ingredient_id as number,
      quantity: row.quantity as number,
    }
  }

  private async loadItems(presetMealId: number): Promise<PresetMealItem[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM preset_meal_items WHERE preset_meal_id = ?', args: [presetMealId] })
    return result.rows.map(row => this.mapItem(row as unknown as Record<string, unknown>))
  }

  async create(userId: string, input: CreatePresetMealInput): Promise<PresetMeal> {
    const result = await this.db.execute({
      sql: 'INSERT INTO preset_meals (user_id, name) VALUES (?, ?) RETURNING *',
      args: [userId, input.name],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to create preset meal')
    const preset = this.mapPreset(row as unknown as Record<string, unknown>)

    for (const item of input.items) {
      await this.db.execute({
        sql: 'INSERT INTO preset_meal_items (preset_meal_id, ingredient_id, quantity) VALUES (?, ?, ?)',
        args: [preset.id, item.ingredientId, item.quantity],
      })
    }

    return { ...preset, items: await this.loadItems(preset.id) }
  }

  async findAllForUser(userId: string): Promise<PresetMeal[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM preset_meals WHERE user_id = ? ORDER BY name', args: [userId] })
    const presets = result.rows.map(row => this.mapPreset(row as unknown as Record<string, unknown>))
    return Promise.all(presets.map(async preset => ({ ...preset, items: await this.loadItems(preset.id) })))
  }

  async findById(id: number, userId: string): Promise<PresetMeal | null> {
    const result = await this.db.execute({ sql: 'SELECT * FROM preset_meals WHERE id = ? AND user_id = ?', args: [id, userId] })
    const row = result.rows[0]
    if (!row) return null
    const preset = this.mapPreset(row as unknown as Record<string, unknown>)
    return { ...preset, items: await this.loadItems(preset.id) }
  }

  async delete(id: number, userId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM preset_meals WHERE id = ? AND user_id = ?', args: [id, userId] })
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/preset-meal.repository.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add server/repositories/preset-meal.repository.ts tests/server/repositories/preset-meal.repository.test.ts
git commit -m "feat(nutrition): add PresetMealRepository"
```

---

## Task 5: Extend `ProfileRepository` with the nutrition target

**Files:**
- Modify: `server/repositories/profile.repository.ts`
- Modify: `tests/server/repositories/profile.repository.test.ts`

**Step 1: Write the failing test**

Read `tests/server/repositories/profile.repository.test.ts` first to match its existing style (it wasn't included above — open it before editing). Add these cases to its `describe` block:

```typescript
  it('exposes nutritionTarget as null until all four macros are set', async () => {
    await repo.upsert('user-1', baseInput)
    const profile = await repo.findByUserId('user-1')
    expect(profile?.nutritionTarget).toBeNull()
  })

  it('sets and clears the nutrition target', async () => {
    await repo.upsert('user-1', baseInput)
    await repo.setNutritionTarget('user-1', { calories: 2400, proteinG: 180, carbsG: 250, fatG: 70 })

    let profile = await repo.findByUserId('user-1')
    expect(profile?.nutritionTarget).toEqual({ calories: 2400, proteinG: 180, carbsG: 250, fatG: 70 })

    await repo.setNutritionTarget('user-1', null)
    profile = await repo.findByUserId('user-1')
    expect(profile?.nutritionTarget).toBeNull()
  })
```

(Reuse whatever `baseInput`/setup fixture the existing test file already defines for `repo.upsert(...)`; adapt names to match.)

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/repositories/profile.repository.test.ts`
Expected: FAIL — `repo.setNutritionTarget is not a function` / `nutritionTarget` undefined

**Step 3: Implement**

In `server/repositories/profile.repository.ts`:

Add the import:
```typescript
import type { MacroTarget } from '~~/shared/types/split.types'
```

In `mapRow`, add before the closing `}` (after `hydrationLastRemindedAt`):
```typescript
      nutritionTarget: row.nutrition_target_calories !== null
        ? {
            calories: row.nutrition_target_calories as number,
            proteinG: row.nutrition_target_protein_g as number,
            carbsG: row.nutrition_target_carbs_g as number,
            fatG: row.nutrition_target_fat_g as number,
          }
        : null,
```

Add a new method, near `setHydrationTarget`:
```typescript
  async setNutritionTarget(userId: string, target: MacroTarget | null): Promise<void> {
    await this.db.execute({
      sql: `UPDATE user_profiles
            SET nutrition_target_calories = ?, nutrition_target_protein_g = ?, nutrition_target_carbs_g = ?, nutrition_target_fat_g = ?,
                updated_at = datetime('now')
            WHERE user_id = ?`,
      args: [target?.calories ?? null, target?.proteinG ?? null, target?.carbsG ?? null, target?.fatG ?? null, userId],
    })
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/repositories/profile.repository.test.ts`
Expected: PASS (all previous tests + 2 new ones)

**Step 5: Run the full test suite to check nothing else broke**

Run: `npx vitest run`
Expected: PASS (the new `nutritionTarget` field on `UserProfile` is additive, so nothing existing should assert on the mapped shape being exactly some smaller object — confirm no failures)

**Step 6: Commit**

```bash
git add server/repositories/profile.repository.ts tests/server/repositories/profile.repository.test.ts
git commit -m "feat(nutrition): add nutrition target to ProfileRepository"
```

---

## Task 6: `NutritionService`

**Files:**
- Create: `server/services/nutrition.service.ts`
- Test: `tests/server/services/nutrition.service.test.ts`

**Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

describe('NutritionService', () => {
  let db: Client
  let service: NutritionService
  let ingredients: IngredientRepository
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    ingredients = new IngredientRepository(db)
    service = new NutritionService(
      ctx,
      ingredients,
      new MealLogRepository(db),
      new PresetMealRepository(db),
      new ProfileRepository(db),
    )
  })

  it('rejects an ingredient with a negative macro', async () => {
    await expect(service.createIngredient({
      name: 'Bad', unitType: 'weight_100g', unitLabel: null, calories: -1, proteinG: 0, carbsG: 0, fatG: 0,
    })).rejects.toThrow()
  })

  it('scales a weight_100g ingredient by grams / 100 when logging', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })

    const log = await service.logMeal('Lunch', [{ ingredientId: chicken.id, quantity: 150 }])
    expect(log.items[0]).toMatchObject({ calories: 247.5, proteinG: 46.5, carbsG: 0, fatG: 5.4 })
  })

  it('scales a count ingredient by quantity directly when logging', async () => {
    const beans = await service.createIngredient({
      name: 'Black beans (can)', unitType: 'count', unitLabel: 'can', calories: 350, proteinG: 21, carbsG: 63, fatG: 1.5,
    })

    const log = await service.logMeal('Dinner', [{ ingredientId: beans.id, quantity: 2 }])
    expect(log.items[0]).toMatchObject({ calories: 700, proteinG: 42, carbsG: 126, fatG: 3 })
  })

  it('rejects logging an unknown ingredient', async () => {
    await expect(service.logMeal('Lunch', [{ ingredientId: 999, quantity: 100 }])).rejects.toThrow()
  })

  it('rejects logging a meal with no items', async () => {
    await expect(service.logMeal('Lunch', [])).rejects.toThrow()
  })

  it('logs a preset meal by resolving its saved items against current ingredient macros', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    const preset = await service.createPresetMeal({ name: 'Post-workout', items: [{ ingredientId: chicken.id, quantity: 200 }] })

    const log = await service.logPresetMeal(preset.id)
    expect(log.name).toBe('Post-workout')
    expect(log.items[0]).toMatchObject({ calories: 330, proteinG: 62 })
  })

  it('computes today\'s totals, target, and signed remaining (which can go negative)', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    await service.setTarget({ calories: 300, proteinG: 40, carbsG: 250, fatG: 70 })
    await service.logMeal('Lunch', [{ ingredientId: chicken.id, quantity: 200 }])

    const today = await service.getToday()
    expect(today.totals).toMatchObject({ calories: 330, proteinG: 62 })
    expect(today.target).toEqual({ calories: 300, proteinG: 40, carbsG: 250, fatG: 70 })
    // over target on calories and protein -> negative remaining, not clamped to 0
    expect(today.remaining?.calories).toBeCloseTo(-30)
    expect(today.remaining?.proteinG).toBeCloseTo(-22)
  })

  it('returns a null target and null remaining when no target is set', async () => {
    const today = await service.getToday()
    expect(today.target).toBeNull()
    expect(today.remaining).toBeNull()
  })

  it('deletes a meal log', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    const log = await service.logMeal('Lunch', [{ ingredientId: chicken.id, quantity: 100 }])
    await service.deleteMealLog(log.id)

    const today = await service.getToday()
    expect(today.meals).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/services/nutrition.service.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
import { createError } from 'h3'
import { BaseService } from '~~/server/services/base.service'
import type { CreateIngredientInput, IngredientRepository, UpdateIngredientInput } from '~~/server/repositories/ingredient.repository'
import type { MealLogItemInput, MealLogRepository } from '~~/server/repositories/meal-log.repository'
import type { CreatePresetMealInput, PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { Ingredient, MealLog, NutritionToday, PresetMeal } from '~~/shared/types/nutrition.types'
import type { MacroTarget } from '~~/shared/types/split.types'
import { toSqliteDatetime } from '~~/server/utils/date'

const todayRange = (): { start: string, end: string } => {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 1)
  return { start: toSqliteDatetime(start), end: toSqliteDatetime(end) }
}

const scaleFor = (ingredient: Ingredient, quantity: number): number =>
  ingredient.unitType === 'weight_100g' ? quantity / 100 : quantity

const requireNonNegative = (values: (number | undefined)[], message: string): void => {
  for (const value of values) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw createError({ statusCode: 400, statusMessage: message })
    }
  }
}

export class NutritionService extends BaseService {
  constructor(
    ctx: RequestContext,
    private ingredients: IngredientRepository,
    private mealLogs: MealLogRepository,
    private presetMeals: PresetMealRepository,
    private profiles: ProfileRepository,
  ) {
    super(ctx)
  }

  listIngredients(): Promise<Ingredient[]> {
    return this.ingredients.findAllForUser(this.ctx.userId)
  }

  createIngredient(input: CreateIngredientInput): Promise<Ingredient> {
    requireNonNegative([input.calories, input.proteinG, input.carbsG, input.fatG], 'Macro values must be non-negative numbers')
    return this.ingredients.create(this.ctx.userId, input)
  }

  async updateIngredient(id: number, input: UpdateIngredientInput): Promise<Ingredient> {
    requireNonNegative([input.calories, input.proteinG, input.carbsG, input.fatG], 'Macro values must be non-negative numbers')
    const updated = await this.ingredients.update(id, this.ctx.userId, input)
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Ingredient not found' })
    return updated
  }

  deleteIngredient(id: number): Promise<void> {
    return this.ingredients.delete(id, this.ctx.userId)
  }

  private async resolveItems(items: { ingredientId: number, quantity: number }[]): Promise<MealLogItemInput[]> {
    if (!items.length) throw createError({ statusCode: 400, statusMessage: 'A meal needs at least one item' })
    return Promise.all(items.map(async (item) => {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'quantity must be a positive number' })
      }
      const ingredient = await this.ingredients.findById(item.ingredientId, this.ctx.userId)
      if (!ingredient) throw createError({ statusCode: 400, statusMessage: `Unknown ingredient ${item.ingredientId}` })
      const scale = scaleFor(ingredient, item.quantity)
      return {
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        quantity: item.quantity,
        calories: ingredient.calories * scale,
        proteinG: ingredient.proteinG * scale,
        carbsG: ingredient.carbsG * scale,
        fatG: ingredient.fatG * scale,
      }
    }))
  }

  async logMeal(name: string | null, items: { ingredientId: number, quantity: number }[]): Promise<MealLog> {
    const resolved = await this.resolveItems(items)
    return this.mealLogs.log(this.ctx.userId, name, resolved)
  }

  async logPresetMeal(presetMealId: number): Promise<MealLog> {
    const preset = await this.presetMeals.findById(presetMealId, this.ctx.userId)
    if (!preset) throw createError({ statusCode: 404, statusMessage: 'Preset meal not found' })
    const resolved = await this.resolveItems(preset.items.map(item => ({ ingredientId: item.ingredientId, quantity: item.quantity })))
    return this.mealLogs.log(this.ctx.userId, preset.name, resolved)
  }

  deleteMealLog(id: number): Promise<void> {
    return this.mealLogs.delete(id, this.ctx.userId)
  }

  listPresetMeals(): Promise<PresetMeal[]> {
    return this.presetMeals.findAllForUser(this.ctx.userId)
  }

  createPresetMeal(input: CreatePresetMealInput): Promise<PresetMeal> {
    if (!input.items.length) throw createError({ statusCode: 400, statusMessage: 'A preset meal needs at least one item' })
    return this.presetMeals.create(this.ctx.userId, input)
  }

  deletePresetMeal(id: number): Promise<void> {
    return this.presetMeals.delete(id, this.ctx.userId)
  }

  async setTarget(target: MacroTarget | null): Promise<void> {
    if (target) requireNonNegative([target.calories, target.proteinG, target.carbsG, target.fatG], 'Macro target values must be non-negative numbers')
    await this.profiles.setNutritionTarget(this.ctx.userId, target)
  }

  async getToday(): Promise<NutritionToday> {
    const { start, end } = todayRange()
    const [meals, profile] = await Promise.all([
      this.mealLogs.findForRange(this.ctx.userId, start, end),
      this.profiles.findByUserId(this.ctx.userId),
    ])

    const totals = meals.reduce((sum, meal) => {
      for (const item of meal.items) {
        sum.calories += item.calories
        sum.proteinG += item.proteinG
        sum.carbsG += item.carbsG
        sum.fatG += item.fatG
      }
      return sum
    }, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })

    const target = profile?.nutritionTarget ?? null
    // Signed, not clamped -- the user wants to know when they're over target, not just "0 to go".
    const remaining = target
      ? {
          calories: target.calories - totals.calories,
          proteinG: target.proteinG - totals.proteinG,
          carbsG: target.carbsG - totals.carbsG,
          fatG: target.fatG - totals.fatG,
        }
      : null

    return { totals, target, remaining, meals }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/services/nutrition.service.test.ts`
Expected: PASS (10 tests)

**Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add server/services/nutrition.service.ts tests/server/services/nutrition.service.test.ts
git commit -m "feat(nutrition): add NutritionService"
```

---

## Task 7: API routes

**Files:**
- Create: `server/api/nutrition/index.get.ts`
- Create: `server/api/nutrition/index.post.ts`
- Create: `server/api/nutrition/[id].delete.ts`
- Create: `server/api/nutrition/target.post.ts`
- Create: `server/api/nutrition/ingredients/index.get.ts`
- Create: `server/api/nutrition/ingredients/index.post.ts`
- Create: `server/api/nutrition/ingredients/[id].patch.ts`
- Create: `server/api/nutrition/ingredients/[id].delete.ts`
- Create: `server/api/nutrition/presets/index.get.ts`
- Create: `server/api/nutrition/presets/index.post.ts`
- Create: `server/api/nutrition/presets/[id].delete.ts`
- Create: `server/api/nutrition/presets/[id]/log.post.ts`

No dedicated tests for these — the existing codebase doesn't unit-test its h3 route handlers (they're thin wrappers verified by the service tests above + manual/E2E checking in Task 12). Each handler follows `server/api/hydration/*.ts` exactly: `getRequestContext`, construct repos + service, delegate, return.

There's no shared "build a NutritionService" helper in this codebase (each hydration route re-instantiates), so don't add one here either — stay consistent.

**Step 1: `server/api/nutrition/index.get.ts`**

```typescript
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get today\'s nutrition summary',
    description: 'Totals, target, signed remaining (can be negative when over target), and today\'s logged meals.',
    responses: {
      200: { description: 'Today\'s nutrition summary' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.getToday()
})
```

**Step 2: `server/api/nutrition/index.post.ts`**

```typescript
import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Log an ad-hoc meal',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['items'],
            properties: {
              name: { type: 'string', nullable: true },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['ingredientId', 'quantity'],
                  properties: {
                    ingredientId: { type: 'number' },
                    quantity: { type: 'number', description: 'Grams if the ingredient is weight_100g, count of unit_label if count' },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The logged meal, with computed per-item macros' },
      400: { description: 'No items, a non-positive quantity, or an unknown ingredientId' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { name?: string | null, items: { ingredientId: number, quantity: number }[] }
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.logMeal(body.name ?? null, body.items)
})
```

**Step 3: `server/api/nutrition/[id].delete.ts`**

```typescript
import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Delete a logged meal',
    description: 'A mistaken id, or one belonging to another user, deletes nothing rather than erroring.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ],
    responses: {
      200: { description: 'Meal deleted (or already gone)' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })

  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  await service.deleteMealLog(id)
  return { success: true }
})
```

**Step 4: `server/api/nutrition/target.post.ts`**

```typescript
import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'
import type { MacroTarget } from '~~/shared/types/split.types'

defineRouteMeta({
  openAPI: {
    summary: 'Set the daily macro target',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['target'],
            properties: {
              target: {
                type: 'object',
                nullable: true,
                description: 'Pass null to clear the target',
                properties: {
                  calories: { type: 'number' },
                  proteinG: { type: 'number' },
                  carbsG: { type: 'number' },
                  fatG: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Target updated' },
      400: { description: 'A macro value was negative' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { target: MacroTarget | null }
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  await service.setTarget(body.target)
  return { target: body.target }
})
```

**Step 5: `server/api/nutrition/ingredients/index.get.ts`**

```typescript
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'

defineRouteMeta({
  openAPI: {
    summary: 'List your ingredient catalog',
    responses: {
      200: { description: 'Ingredients, alphabetically' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  return new IngredientRepository(useDb()).findAllForUser(ctx.userId)
})
```

**Step 6: `server/api/nutrition/ingredients/index.post.ts`**

```typescript
import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository, type CreateIngredientInput } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Add an ingredient to your catalog',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'unitType', 'calories', 'proteinG', 'carbsG', 'fatG'],
            properties: {
              name: { type: 'string' },
              unitType: { type: 'string', enum: ['weight_100g', 'count'] },
              unitLabel: { type: 'string', nullable: true, description: 'e.g. cup, can, scoop. Required when unitType is count.' },
              calories: { type: 'number' },
              proteinG: { type: 'number' },
              carbsG: { type: 'number' },
              fatG: { type: 'number' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The created ingredient' },
      400: { description: 'A macro value was negative' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as CreateIngredientInput
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.createIngredient(body)
})
```

**Step 7: `server/api/nutrition/ingredients/[id].patch.ts`**

```typescript
import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository, type UpdateIngredientInput } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Update an ingredient',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ],
    responses: {
      200: { description: 'The updated ingredient' },
      400: { description: 'Invalid id, or a negative macro value' },
      404: { description: 'Ingredient not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })

  const body = await readBody(event) as UpdateIngredientInput
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.updateIngredient(id, body)
})
```

**Step 8: `server/api/nutrition/ingredients/[id].delete.ts`**

```typescript
import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Delete an ingredient',
    description: 'Past meal log items keep their snapshot macros/name and are unaffected.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ],
    responses: {
      200: { description: 'Ingredient deleted (or already gone)' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })

  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  await service.deleteIngredient(id)
  return { success: true }
})
```

**Step 9: `server/api/nutrition/presets/index.get.ts`**

```typescript
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'

defineRouteMeta({
  openAPI: {
    summary: 'List your preset meals',
    responses: {
      200: { description: 'Preset meals, alphabetically, with items' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  return new PresetMealRepository(useDb()).findAllForUser(ctx.userId)
})
```

**Step 10: `server/api/nutrition/presets/index.post.ts`**

```typescript
import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository, type CreatePresetMealInput } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Save a preset meal',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'items'],
            properties: {
              name: { type: 'string' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['ingredientId', 'quantity'],
                  properties: {
                    ingredientId: { type: 'number' },
                    quantity: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The created preset meal' },
      400: { description: 'No items' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as CreatePresetMealInput
  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.createPresetMeal(body)
})
```

**Step 11: `server/api/nutrition/presets/[id].delete.ts`**

```typescript
import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Delete a preset meal',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ],
    responses: {
      200: { description: 'Preset deleted (or already gone)' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })

  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  await service.deletePresetMeal(id)
  return { success: true }
})
```

**Step 12: `server/api/nutrition/presets/[id]/log.post.ts`**

```typescript
import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'

defineRouteMeta({
  openAPI: {
    summary: 'Quick-log a preset meal as eaten now',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ],
    responses: {
      200: { description: 'The newly logged meal, with macros resolved from current ingredient data' },
      404: { description: 'Preset meal not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })

  const db = useDb()
  const service = new NutritionService(
    ctx,
    new IngredientRepository(db),
    new MealLogRepository(db),
    new PresetMealRepository(db),
    new ProfileRepository(db),
  )
  return service.logPresetMeal(id)
})
```

**Step 13: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

**Step 14: Manual smoke test**

Run: `npm run dev`, then in another terminal (adjust the session cookie to a real logged-in session, or drive it through the browser instead — see Task 12 for the full flow):

```bash
curl -s http://localhost:3000/api/nutrition -H "Cookie: session=<your-session-cookie>" | jq
```

Expected: `{"totals":{"calories":0,"proteinG":0,"carbsG":0,"fatG":0},"target":null,"remaining":null,"meals":[]}`

**Step 15: Commit**

```bash
git add server/api/nutrition
git commit -m "feat(nutrition): add API routes"
```

---

## Task 8: Frontend types passthrough check

The types added in Task 1 (`shared/types/nutrition.types.ts`, `UserProfile.nutritionTarget`) are already importable from the `app/` layer via the existing `~~/shared/types/*` alias — no separate step needed. Skip ahead to composables.

---

## Task 9: Composables

**Files:**
- Modify: `app/composables/query-keys.ts`
- Create: `app/composables/useNutritionToday.ts`
- Create: `app/composables/useLogMeal.ts`
- Create: `app/composables/useLogPresetMeal.ts`
- Create: `app/composables/useDeleteMealLog.ts`
- Create: `app/composables/useSetNutritionTarget.ts`
- Create: `app/composables/useIngredients.ts`
- Create: `app/composables/useCreateIngredient.ts`
- Create: `app/composables/useDeleteIngredient.ts`
- Create: `app/composables/usePresetMeals.ts`
- Create: `app/composables/useCreatePresetMeal.ts`
- Create: `app/composables/useDeletePresetMeal.ts`

No tests here — composables aren't unit-tested elsewhere in this codebase (they're thin `useQuery`/`useMutation` wrappers, verified via the manual browser pass in Task 12).

**Step 1: Add query keys**

In `app/composables/query-keys.ts`, add to the `queryKeys` object:

```typescript
  nutrition: () => ['nutrition'] as const,
  ingredients: () => ['ingredients'] as const,
  presetMeals: () => ['preset-meals'] as const,
```

**Step 2: `useNutritionToday.ts`**

```typescript
import type { FetchError } from 'ofetch'
import type { NutritionToday } from '~~/shared/types/nutrition.types'
import { useQuery } from '@pinia/colada'

export const useNutritionToday = () => {
  const { $api } = useNuxtApp()

  return useQuery<NutritionToday, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.nutrition(),
    query: () => $api<NutritionToday>('/api/nutrition'),
  })
}
```

**Step 3: `useLogMeal.ts`**

```typescript
import type { FetchError } from 'ofetch'
import type { MealLog } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface LogMealInput {
  name?: string | null
  items: { ingredientId: number, quantity: number }[]
}

export const useLogMeal = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<MealLog, LogMealInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<MealLog>('/api/nutrition', {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.nutrition() }),
  })
}
```

**Step 4: `useLogPresetMeal.ts`**

```typescript
import type { FetchError } from 'ofetch'
import type { MealLog } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useLogPresetMeal = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<MealLog, number, FetchError<{ statusMessage: string }>>({
    mutation: presetMealId => $api<MealLog>(`/api/nutrition/presets/${presetMealId}/log`, {
      method: 'POST',
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.nutrition() }),
  })
}
```

**Step 5: `useDeleteMealLog.ts`**

```typescript
import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useDeleteMealLog = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ success: boolean }, number, FetchError<{ statusMessage: string }>>({
    mutation: id => $api<{ success: boolean }>(`/api/nutrition/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.nutrition() }),
  })
}
```

**Step 6: `useSetNutritionTarget.ts`**

```typescript
import type { FetchError } from 'ofetch'
import type { MacroTarget } from '~~/shared/types/split.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useSetNutritionTarget = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ target: MacroTarget | null }, MacroTarget | null, FetchError<{ statusMessage: string }>>({
    mutation: target => $api<{ target: MacroTarget | null }>('/api/nutrition/target', {
      method: 'POST',
      body: { target },
    }),
    onSuccess: () => {
      queryCache.invalidateQueries({ key: queryKeys.nutrition() })
      queryCache.invalidateQueries({ key: queryKeys.profile() })
    },
  })
}
```

**Step 7: `useIngredients.ts`**

```typescript
import type { FetchError } from 'ofetch'
import type { Ingredient } from '~~/shared/types/nutrition.types'
import { useQuery } from '@pinia/colada'

export const useIngredients = () => {
  const { $api } = useNuxtApp()

  return useQuery<Ingredient[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.ingredients(),
    query: () => $api<Ingredient[]>('/api/nutrition/ingredients'),
  })
}
```

**Step 8: `useCreateIngredient.ts`**

```typescript
import type { FetchError } from 'ofetch'
import type { CreateIngredientInput } from '~~/server/repositories/ingredient.repository'
import type { Ingredient } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useCreateIngredient = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<Ingredient, CreateIngredientInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<Ingredient>('/api/nutrition/ingredients', {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.ingredients() }),
  })
}
```

**Step 9: `useDeleteIngredient.ts`**

```typescript
import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useDeleteIngredient = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ success: boolean }, number, FetchError<{ statusMessage: string }>>({
    mutation: id => $api<{ success: boolean }>(`/api/nutrition/ingredients/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.ingredients() }),
  })
}
```

**Step 10: `usePresetMeals.ts`**

```typescript
import type { FetchError } from 'ofetch'
import type { PresetMeal } from '~~/shared/types/nutrition.types'
import { useQuery } from '@pinia/colada'

export const usePresetMeals = () => {
  const { $api } = useNuxtApp()

  return useQuery<PresetMeal[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.presetMeals(),
    query: () => $api<PresetMeal[]>('/api/nutrition/presets'),
  })
}
```

**Step 11: `useCreatePresetMeal.ts`**

```typescript
import type { FetchError } from 'ofetch'
import type { CreatePresetMealInput } from '~~/server/repositories/preset-meal.repository'
import type { PresetMeal } from '~~/shared/types/nutrition.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useCreatePresetMeal = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<PresetMeal, CreatePresetMealInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<PresetMeal>('/api/nutrition/presets', {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.presetMeals() }),
  })
}
```

**Step 12: `useDeletePresetMeal.ts`**

```typescript
import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useDeletePresetMeal = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ success: boolean }, number, FetchError<{ statusMessage: string }>>({
    mutation: id => $api<{ success: boolean }>(`/api/nutrition/presets/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.presetMeals() }),
  })
}
```

**Step 13: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no new errors from the files touched in this task

**Step 14: Commit**

```bash
git add app/composables
git commit -m "feat(nutrition): add frontend composables"
```

---

## Task 10: Home page Nutrition card

**Files:**
- Modify: `app/pages/index.vue`

**Step 1: Add the composable calls**

In the `<script setup>` block of `app/pages/index.vue`, after the existing `useLogHydration()` line, add:

```typescript
const { data: nutrition } = useNutritionToday();
const caloriePct = computed(() => {
  if (!nutrition.value?.target?.calories) return 0;
  return Math.min(100, Math.round((nutrition.value.totals.calories / nutrition.value.target.calories) * 100));
});
const remainingLabel = (remaining: number | undefined): string => {
  if (remaining === undefined) return "";
  return remaining >= 0 ? `${Math.round(remaining)} to go` : `${Math.round(-remaining)} over`;
};
```

**Step 2: Add the card markup**

After the closing `</div>` of the Hydration `<div class="space-y-2">` block (i.e. right before the final `</div>` / `<div v-else>Is Loading</div>`), add:

```html
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <UtensilsIcon class="size-4.5 text-lime" />
        <h2 class="font-heading text-lg uppercase text-foreground">Nutrition</h2>
      </div>
      <UiCard class="w-full space-y-4 rounded-xl border border-surface-strong bg-card p-5">
        <div class="flex items-end justify-between">
          <div>
            <p class="font-heading text-2xl text-foreground [font-variant-numeric:tabular-nums]">
              {{ Math.round(nutrition?.totals.calories ?? 0).toLocaleString() }}<span
                class="font-sans text-sm font-normal text-muted-foreground"
              >cal</span>
            </p>
            <p v-if="nutrition?.target" class="text-xs text-muted-foreground">
              {{ remainingLabel(nutrition.remaining?.calories) }}
            </p>
            <p v-else class="text-xs text-muted-foreground">
              No daily target --
              <NuxtLink to="/profile" class="text-cyan-pale underline">set one</NuxtLink>
            </p>
          </div>
          <span
            v-if="nutrition?.target"
            class="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]"
          >
            {{ Math.round(nutrition.target.calories).toLocaleString() }}cal goal
          </span>
        </div>
        <div v-if="nutrition?.target" class="h-1.5 overflow-hidden rounded-full bg-muted">
          <div class="h-full rounded-full bg-lime transition-[width]" :style="{ width: `${caloriePct}%` }" />
        </div>
        <div v-if="nutrition?.target" class="grid grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          <span>P {{ Math.round(nutrition.totals.proteinG) }}g</span>
          <span>C {{ Math.round(nutrition.totals.carbsG) }}g</span>
          <span>F {{ Math.round(nutrition.totals.fatG) }}g</span>
        </div>
        <NuxtLink to="/nutrition">
          <Button variant="secondary" size="sm">Log meal</Button>
        </NuxtLink>
      </UiCard>
    </div>
```

**Step 3: Import the icon**

Update the existing lucide import line at the top of the file:

```typescript
import { DropletIcon, FlameIcon, FlameKindlingIcon, StarIcon, UtensilsIcon } from "@lucide/vue";
```

**Step 4: Verify in the browser**

Run: `npm run dev`, visit `http://localhost:3000/`, log in.
Expected: A "Nutrition" card appears below Hydration showing "0cal", "No daily target -- set one", and a "Log meal" button linking to `/nutrition` (which doesn't exist yet — a 404 here is expected until Task 12).

**Step 5: Commit**

```bash
git add app/pages/index.vue
git commit -m "feat(nutrition): add nutrition card to home page"
```

---

## Task 11: Profile page — Nutrition Target section

**Files:**
- Modify: `app/pages/profile.vue`

**Step 1: Add state + save handler**

In `<script setup>`, after the existing `onRemindersToggle`/`onIntervalChange` block, add:

```typescript
const { mutate: saveTarget, isLoading: targetSaving } = useSetNutritionTarget();
const targetCalories = ref<number | null>(null);
const targetProtein = ref<number | null>(null);
const targetCarbs = ref<number | null>(null);
const targetFat = ref<number | null>(null);
let seededTargetFromProfile = false;
watch(profileData, (data) => {
  if (seededTargetFromProfile || !data?.profile) return;
  const target = data.profile.nutritionTarget;
  targetCalories.value = target?.calories ?? null;
  targetProtein.value = target?.proteinG ?? null;
  targetCarbs.value = target?.carbsG ?? null;
  targetFat.value = target?.fatG ?? null;
  seededTargetFromProfile = true;
}, { immediate: true });

const onSaveTarget = () => {
  const hasAllFields =
    targetCalories.value !== null && targetProtein.value !== null &&
    targetCarbs.value !== null && targetFat.value !== null;
  saveTarget(
    hasAllFields
      ? { calories: targetCalories.value!, proteinG: targetProtein.value!, carbsG: targetCarbs.value!, fatG: targetFat.value! }
      : null,
  );
};
```

**Step 2: Add the section markup**

After the closing `</section>` of "Hydration Reminders" and before the "Achievements" `<section>`, add:

```html
    <section class="space-y-3">
      <div class="flex items-center gap-2">
        <UtensilsIcon class="size-4.5 text-lime" />
        <h2 class="font-heading text-lg uppercase text-foreground">Nutrition Target</h2>
      </div>
      <div class="space-y-4 rounded-xl border border-surface-strong bg-card p-4">
        <p class="text-xs text-muted-foreground">Leave any field blank to clear your target entirely.</p>
        <div class="grid grid-cols-2 gap-3">
          <UiMetricInput v-model="targetCalories" unit="cal" />
          <UiMetricInput v-model="targetProtein" unit="g protein" />
          <UiMetricInput v-model="targetCarbs" unit="g carbs" />
          <UiMetricInput v-model="targetFat" unit="g fat" />
        </div>
        <Button variant="secondary" size="sm" :disabled="targetSaving" @click="onSaveTarget">Save target</Button>
      </div>
    </section>
```

**Step 3: Import the icon + Button**

Update the icon import line:

```typescript
import { BellIcon, DumbbellIcon, FlameIcon, LockIcon, TrendingUpIcon, UtensilsIcon, WeightIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
```

(`Button` isn't currently imported in `profile.vue` — check the top of the file before adding a duplicate import.)

**Step 4: Verify in the browser**

Run: `npm run dev`, visit `http://localhost:3000/profile`.
Expected: A "Nutrition Target" section with 4 number inputs and a "Save target" button appears between "Hydration Reminders" and "Achievements". Enter values in all 4 fields, save, reload the page — values persist. Clear all 4, save, reload — fields are empty and the home page's Nutrition card goes back to "No daily target".

**Step 5: Commit**

```bash
git add app/pages/profile.vue
git commit -m "feat(nutrition): add nutrition target section to profile page"
```

---

## Task 12: `/nutrition` page

**Files:**
- Create: `app/pages/nutrition.vue`

This is the biggest single file in the plan. Build it in three passes so it's testable incrementally rather than as one 300-line diff.

**Step 1: Page shell + Today tab (totals, meal list, delete)**

Create `app/pages/nutrition.vue`:

```vue
<script setup lang="ts">
import { PlusIcon, TrashIcon, UtensilsIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";

definePageMeta({});

type Tab = "today" | "ingredients" | "presets";
const tab = ref<Tab>("today");

const { data: nutrition } = useNutritionToday();
const deleteMealLog = useDeleteMealLog();

const remainingLabel = (remaining: number | undefined): string => {
  if (remaining === undefined) return "";
  return remaining >= 0 ? `${Math.round(remaining)} left` : `${Math.round(-remaining)} over`;
};
const macroPct = (consumed: number, target: number | undefined): number => {
  if (!target) return 0;
  return Math.min(100, Math.round((consumed / target) * 100));
};
</script>

<template>
  <main class="mx-auto max-w-xl space-y-6 p-6 pb-24">
    <div class="flex items-center gap-2">
      <UtensilsIcon class="size-5 text-lime" />
      <h1 class="font-heading text-2xl uppercase text-foreground">Nutrition</h1>
    </div>

    <div class="flex gap-2 border-b border-surface-strong">
      <button
        v-for="t in (['today', 'ingredients', 'presets'] as Tab[])"
        :key="t"
        class="px-3 py-2 font-mono text-xs uppercase tracking-[1px]"
        :class="tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'"
        @click="tab = t"
      >
        {{ t }}
      </button>
    </div>

    <section v-if="tab === 'today'" class="space-y-4">
      <UiCard class="space-y-4 rounded-xl border border-surface-strong bg-card p-5">
        <div v-if="nutrition?.target" class="grid grid-cols-2 gap-4">
          <div v-for="(label, key) in { calories: 'Calories', proteinG: 'Protein', carbsG: 'Carbs', fatG: 'Fat' }" :key="key" class="space-y-1">
            <div class="flex items-baseline justify-between">
              <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{{ label }}</span>
              <span class="font-mono text-[10px] text-muted-foreground">{{ remainingLabel(nutrition.remaining?.[key]) }}</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-lime transition-[width]" :style="{ width: `${macroPct(nutrition.totals[key], nutrition.target?.[key])}%` }" />
            </div>
            <p class="font-heading text-lg text-foreground [font-variant-numeric:tabular-nums]">
              {{ Math.round(nutrition.totals[key]) }}<span class="text-xs text-muted-foreground">/{{ Math.round(nutrition.target[key]) }}{{ key === 'calories' ? 'cal' : 'g' }}</span>
            </p>
          </div>
        </div>
        <p v-else class="text-sm text-muted-foreground">
          No daily target set --
          <NuxtLink to="/profile" class="text-cyan-pale underline">set one</NuxtLink>
        </p>
      </UiCard>

      <div class="space-y-2">
        <div v-for="meal in nutrition?.meals ?? []" :key="meal.id" class="rounded-xl border border-surface-strong bg-card p-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-sm font-semibold text-foreground">{{ meal.name ?? "Meal" }}</p>
              <p class="font-mono text-[10px] text-muted-foreground">
                {{ Math.round(meal.items.reduce((s, i) => s + i.calories, 0)) }}cal --
                {{ meal.items.map((i) => i.ingredientName).join(", ") }}
              </p>
            </div>
            <button :disabled="deleteMealLog.isLoading.value" @click="deleteMealLog.mutate(meal.id)">
              <TrashIcon class="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>
        <p v-if="!nutrition?.meals.length" class="text-center text-sm text-muted-foreground">No meals logged today.</p>
      </div>

      <NuxtLink to="/nutrition/log">
        <Button variant="secondary" class="w-full gap-2"><PlusIcon class="size-4" />Log Meal</Button>
      </NuxtLink>
    </section>
  </main>
</template>
```

Note the `nutrition.totals[key]` / `nutrition.target[key]` dynamic indexing in the `v-for="(label, key) in {...}"` loop: `key` is typed as the object's key union by Vue's template type inference, and `MacroTarget`'s fields (`calories`, `proteinG`, `carbsG`, `fatG`) are exactly that union, so this indexes cleanly — no `as any` needed. Confirm this compiles in Step 2's type-check; if `vue-tsc` complains about the index signature, fall back to four explicit blocks (one per macro) instead of the loop.

**Step 2: Type-check and browser-test the Today tab**

Run: `npx vue-tsc --noEmit`
Expected: no new errors. If the dynamic-key loop from Step 1 doesn't type-check, replace it with four explicit non-looped blocks and re-run.

Run: `npm run dev`, visit `http://localhost:3000/nutrition`.
Expected: page loads, shows "No daily target set" (until Task 11's target is saved) or the 4 macro bars, and "No meals logged today." The "Log Meal" button links to `/nutrition/log`, which doesn't exist yet — expected 404 for now.

**Step 3: Commit the shell**

```bash
git add app/pages/nutrition.vue
git commit -m "feat(nutrition): add /nutrition page today tab"
```

**Step 4: Ingredients tab**

Add to the `<script setup>` block:

```typescript
const { data: ingredients } = useIngredients();
const createIngredient = useCreateIngredient();
const deleteIngredient = useDeleteIngredient();

const newIngredient = ref({
  name: "",
  unitType: "weight_100g" as "weight_100g" | "count",
  unitLabel: "",
  calories: null as number | null,
  proteinG: null as number | null,
  carbsG: null as number | null,
  fatG: null as number | null,
});
const showNewIngredientForm = ref(false);

const onCreateIngredient = () => {
  createIngredient.mutate({
    name: newIngredient.value.name,
    unitType: newIngredient.value.unitType,
    unitLabel: newIngredient.value.unitType === "count" ? newIngredient.value.unitLabel : null,
    calories: newIngredient.value.calories ?? 0,
    proteinG: newIngredient.value.proteinG ?? 0,
    carbsG: newIngredient.value.carbsG ?? 0,
    fatG: newIngredient.value.fatG ?? 0,
  }, {
    onSuccess: () => {
      newIngredient.value = { name: "", unitType: "weight_100g", unitLabel: "", calories: null, proteinG: null, carbsG: null, fatG: null };
      showNewIngredientForm.value = false;
    },
  });
};
```

Add the `Ingredients` tab section markup, right after the Today `</section>`:

```html
    <section v-if="tab === 'ingredients'" class="space-y-4">
      <div v-for="ingredient in ingredients ?? []" :key="ingredient.id" class="flex items-center justify-between rounded-xl border border-surface-strong bg-card p-4">
        <div>
          <p class="text-sm font-semibold text-foreground">{{ ingredient.name }}</p>
          <p class="font-mono text-[10px] text-muted-foreground">
            {{ ingredient.calories }}cal / {{ ingredient.unitType === 'weight_100g' ? '100g' : `1 ${ingredient.unitLabel}` }}
            -- P{{ ingredient.proteinG }} C{{ ingredient.carbsG }} F{{ ingredient.fatG }}
          </p>
        </div>
        <button :disabled="deleteIngredient.isLoading.value" @click="deleteIngredient.mutate(ingredient.id)">
          <TrashIcon class="size-4 text-muted-foreground" />
        </button>
      </div>
      <p v-if="!ingredients?.length" class="text-center text-sm text-muted-foreground">No ingredients yet.</p>

      <Button v-if="!showNewIngredientForm" variant="secondary" class="w-full gap-2" @click="showNewIngredientForm = true">
        <PlusIcon class="size-4" />Add Ingredient
      </Button>
      <div v-else class="space-y-3 rounded-xl border border-surface-strong bg-card p-4">
        <UiInput v-model="newIngredient.name" placeholder="Name (e.g. Chicken breast)" />
        <UiNativeSelect v-model="newIngredient.unitType">
          <UiNativeSelectOption value="weight_100g">Per 100g</UiNativeSelectOption>
          <UiNativeSelectOption value="count">Per count (cup, can, scoop...)</UiNativeSelectOption>
        </UiNativeSelect>
        <UiInput v-if="newIngredient.unitType === 'count'" v-model="newIngredient.unitLabel" placeholder="Unit label (e.g. can)" />
        <div class="grid grid-cols-2 gap-3">
          <UiMetricInput v-model="newIngredient.calories" unit="cal" />
          <UiMetricInput v-model="newIngredient.proteinG" unit="g protein" />
          <UiMetricInput v-model="newIngredient.carbsG" unit="g carbs" />
          <UiMetricInput v-model="newIngredient.fatG" unit="g fat" />
        </div>
        <div class="flex gap-2">
          <Button :disabled="createIngredient.isLoading.value || !newIngredient.name" @click="onCreateIngredient">Save</Button>
          <Button variant="secondary" @click="showNewIngredientForm = false">Cancel</Button>
        </div>
      </div>
    </section>
```

**Step 5: Verify the Ingredients tab in the browser**

Run: `npm run dev`, visit `/nutrition`, click the "Ingredients" tab.
Expected: empty state, then "Add Ingredient" reveals the form. Create "Chicken breast" (weight_100g, 165/31/0/3.6) — it appears in the list. Create "Black beans" (count, unit label "can", 350/21/63/1.5) — it appears showing "1 can". Delete one — it disappears.

**Step 6: Commit**

```bash
git add app/pages/nutrition.vue
git commit -m "feat(nutrition): add ingredients tab"
```

**Step 7: Presets tab + the meal-logging drawer**

The logging flow lives in a `Drawer` (per the design's "opens a Drawer" decision) rather than a separate `/nutrition/log` route — update the Today tab's `NuxtLink to="/nutrition/log"` from Step 1 into a `UiDrawerTrigger` instead. Add to `<script setup>`:

```typescript
import {
  Drawer as UiDrawer,
  DrawerContent as UiDrawerContent,
  DrawerHeader as UiDrawerHeader,
  DrawerTitle as UiDrawerTitle,
  DrawerTrigger as UiDrawerTrigger,
} from "@/components/ui/drawer";

const { data: presetMeals } = usePresetMeals();
const createPresetMeal = useCreatePresetMeal();
const deletePresetMeal = useDeletePresetMeal();
const logMeal = useLogMeal();
const logPresetMeal = useLogPresetMeal();

const logDrawerOpen = ref(false);
const draftItems = ref<{ ingredientId: number, quantity: number }[]>([]);
const draftIngredientId = ref<number | null>(null);
const draftQuantity = ref<number | null>(null);

const addDraftItem = () => {
  if (draftIngredientId.value === null || !draftQuantity.value) return;
  draftItems.value.push({ ingredientId: draftIngredientId.value, quantity: draftQuantity.value });
  draftIngredientId.value = null;
  draftQuantity.value = null;
};
const removeDraftItem = (index: number) => draftItems.value.splice(index, 1);

const draftTotals = computed(() => {
  return draftItems.value.reduce((sum, item) => {
    const ingredient = ingredients.value?.find((i) => i.id === item.ingredientId);
    if (!ingredient) return sum;
    const scale = ingredient.unitType === "weight_100g" ? item.quantity / 100 : item.quantity;
    sum.calories += ingredient.calories * scale;
    sum.proteinG += ingredient.proteinG * scale;
    return sum;
  }, { calories: 0, proteinG: 0 });
});

const onSaveMeal = () => {
  logMeal.mutate({ items: draftItems.value }, {
    onSuccess: () => {
      draftItems.value = [];
      logDrawerOpen.value = false;
    },
  });
};

const onQuickLogPreset = (presetMealId: number) => logPresetMeal.mutate(presetMealId);

const newPresetName = ref("");
const showNewPresetForm = ref(false);
const onCreatePreset = () => {
  createPresetMeal.mutate({ name: newPresetName.value, items: draftItems.value }, {
    onSuccess: () => {
      newPresetName.value = "";
      draftItems.value = [];
      showNewPresetForm.value = false;
    },
  });
};
```

Replace the Today tab's closing `NuxtLink`/`Button` ("Log Meal") with a drawer trigger:

```html
      <UiDrawer v-model:open="logDrawerOpen">
        <UiDrawerTrigger as-child>
          <Button variant="secondary" class="w-full gap-2"><PlusIcon class="size-4" />Log Meal</Button>
        </UiDrawerTrigger>
        <UiDrawerContent>
          <UiDrawerHeader>
            <UiDrawerTitle>Log a meal</UiDrawerTitle>
          </UiDrawerHeader>
          <div class="space-y-4 px-4 pb-4">
            <div v-if="presetMeals?.length" class="space-y-2">
              <p class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Presets</p>
              <div class="flex flex-wrap gap-2">
                <Button
                  v-for="preset in presetMeals"
                  :key="preset.id"
                  variant="secondary"
                  size="sm"
                  :disabled="logPresetMeal.isLoading.value"
                  @click="onQuickLogPreset(preset.id)"
                >
                  {{ preset.name }}
                </Button>
              </div>
            </div>

            <div class="space-y-2">
              <p class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Build a meal</p>
              <div class="flex gap-2">
                <UiNativeSelect v-model="draftIngredientId" class="flex-1">
                  <UiNativeSelectOption :value="null" disabled>Pick an ingredient</UiNativeSelectOption>
                  <UiNativeSelectOption v-for="ingredient in ingredients ?? []" :key="ingredient.id" :value="ingredient.id">
                    {{ ingredient.name }}
                  </UiNativeSelectOption>
                </UiNativeSelect>
                <UiMetricInput v-model="draftQuantity" :unit="ingredients?.find((i) => i.id === draftIngredientId)?.unitType === 'count' ? (ingredients?.find((i) => i.id === draftIngredientId)?.unitLabel ?? 'x') : 'g'" class="w-32" />
                <Button size="sm" @click="addDraftItem">Add</Button>
              </div>

              <div v-for="(item, index) in draftItems" :key="index" class="flex items-center justify-between text-sm text-foreground">
                <span>{{ item.quantity }} -- {{ ingredients?.find((i) => i.id === item.ingredientId)?.name }}</span>
                <button @click="removeDraftItem(index)"><TrashIcon class="size-3.5 text-muted-foreground" /></button>
              </div>

              <p v-if="draftItems.length" class="font-mono text-xs text-muted-foreground">
                {{ Math.round(draftTotals.calories) }}cal / {{ Math.round(draftTotals.proteinG) }}g protein
              </p>
            </div>

            <div class="flex gap-2">
              <Button :disabled="!draftItems.length || logMeal.isLoading.value" @click="onSaveMeal">Log meal</Button>
              <Button
                v-if="!showNewPresetForm"
                variant="secondary"
                :disabled="!draftItems.length"
                @click="showNewPresetForm = true"
              >
                Save as preset
              </Button>
            </div>
            <div v-if="showNewPresetForm" class="flex gap-2">
              <UiInput v-model="newPresetName" placeholder="Preset name" class="flex-1" />
              <Button :disabled="!newPresetName || createPresetMeal.isLoading.value" @click="onCreatePreset">Save</Button>
            </div>
          </div>
        </UiDrawerContent>
      </UiDrawer>
```

Also add the `Presets` tab section markup, after the Ingredients `</section>`:

```html
    <section v-if="tab === 'presets'" class="space-y-4">
      <div v-for="preset in presetMeals ?? []" :key="preset.id" class="flex items-center justify-between rounded-xl border border-surface-strong bg-card p-4">
        <div>
          <p class="text-sm font-semibold text-foreground">{{ preset.name }}</p>
          <p class="font-mono text-[10px] text-muted-foreground">{{ preset.items.length }} ingredient(s)</p>
        </div>
        <div class="flex items-center gap-3">
          <Button size="sm" variant="secondary" :disabled="logPresetMeal.isLoading.value" @click="onQuickLogPreset(preset.id)">Log now</Button>
          <button :disabled="deletePresetMeal.isLoading.value" @click="deletePresetMeal.mutate(preset.id)">
            <TrashIcon class="size-4 text-muted-foreground" />
          </button>
        </div>
      </div>
      <p v-if="!presetMeals?.length" class="text-center text-sm text-muted-foreground">No preset meals yet -- build one from the Today tab's "Log Meal" drawer and save it.</p>
    </section>
```

Check `app/components/ui/drawer/index.ts` before writing the import above to confirm the exact exported names (`Drawer`, `DrawerContent`, `DrawerHeader`, `DrawerTitle`, `DrawerTrigger`) match — adjust names if they differ.

**Step 8: Verify the full flow in the browser**

Run: `npm run dev`, visit `/nutrition`.
1. Ingredients tab: confirm the two test ingredients from Step 5 are still there (or recreate them).
2. Today tab → "Log Meal" → pick "Chicken breast", quantity 150 → Add → confirm the running total shows ~247cal/46g protein → "Log meal".
3. Confirm the drawer closes, the meal list now shows "Meal -- Chicken breast", and the totals bar (if a target is set) reflects it.
4. Open "Log Meal" again, add an item, "Save as preset" with a name → confirm it appears under the Presets tab.
5. Presets tab → "Log now" on that preset → confirm a second meal appears on the Today tab.
6. Delete both meals from the Today tab → confirm totals return to 0.
7. Confirm the home page (`/`) Nutrition card reflects the same totals after a refresh.

**Step 9: Commit**

```bash
git add app/pages/nutrition.vue
git commit -m "feat(nutrition): add meal logging drawer and presets tab"
```

---

## Task 13: Full regression pass

**Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: PASS, including all pre-existing tests

**Step 2: Type-check the whole project**

Run: `npx vue-tsc --noEmit`
Expected: no errors

**Step 3: Lint**

Run: `npx eslint app server shared`
Expected: no errors (fix any `no-unused-vars`/import-order issues the new files introduced)

**Step 4: Final manual pass**

Repeat the Task 12 Step 8 flow once more end-to-end after the full regression pass, plus:
- Confirm `/profile`'s Hydration Reminders section still works (Task 11 edited the same file).
- Confirm the home page's Hydration card still works (Task 10 edited the same file).

**Step 5: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(nutrition): address lint/type-check findings"
```
