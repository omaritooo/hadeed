# Adaptive TDEE Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Estimate a user's real TDEE from 28 days of logged intake and weigh-ins, and offer a one-tap target update when it differs meaningfully from their current target.

**Architecture:** A pure `estimateTdee` in `shared/lib/adaptive-tdee.ts` (least-squares weight slope, confidence blending toward the formula TDEE, sanity bounds). A `TdeeEstimateService` reads two grouped queries plus the existing formula TDEE from `ProfileService.getComputedStats`, and decides `shouldSuggest`. Two routes and a card on Nutrition → Today; a line on Profile.

**Tech Stack:** Nuxt 4 / Nitro, libSQL, Vitest, `@pinia/colada`.

**Design doc:** `docs/plans/2026-09-14-adaptive-tdee-design.md` (step 3 was revised during planning to least-squares on raw weigh-ins; see the note there).

---

## Before you start

- Independent of the other 2026-09-14 plans; can run in any order.
- `npx vitest run` green before Task 1. Commit on `main`, explicit paths, messages ending
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: `estimateTdee` pure function

**Files:**
- Create: `shared/lib/adaptive-tdee.ts`
- Create: `tests/shared/lib/adaptive-tdee.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/shared/lib/adaptive-tdee.test.ts
import { describe, expect, it } from 'vitest'
import { estimateTdee, weightSlopeKgPerDay } from '~~/shared/lib/adaptive-tdee'

const WINDOW_START = '2026-08-01'
const day = (offset: number) => {
  const d = new Date(`${WINDOW_START}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const intake = (days: number, calories: number, from = 0) =>
  Array.from({ length: days }, (_, i) => ({ date: day(from + i), calories }))
const weighIns = (offsets: number[], weightAt: (offset: number) => number) =>
  offsets.map(offset => ({ date: day(offset), weightKg: weightAt(offset) }))
const EVERY_OTHER_DAY = Array.from({ length: 14 }, (_, i) => i * 2) // 0..26

describe('weightSlopeKgPerDay', () => {
  it('recovers a linear trend exactly', () => {
    expect(weightSlopeKgPerDay(weighIns([0, 7, 14, 21], d => 90 - 0.1 * d))).toBeCloseTo(-0.1, 10)
  })

  it('accepts recorded_at timestamps, not just dates', () => {
    expect(weightSlopeKgPerDay([{ date: '2026-08-01T07:30:00.000Z', weightKg: 80 }, { date: '2026-08-11 07:30:00', weightKg: 81 }])).toBeCloseTo(0.1, 10)
  })
})

describe('estimateTdee', () => {
  it('equals average intake when weight is flat', () => {
    const result = estimateTdee({ dailyIntake: intake(28, 2500), weighIns: weighIns(EVERY_OTHER_DAY, () => 80), formulaTdee: 2300, calorieTarget: 2400 })
    expect(result).toMatchObject({ status: 'ready', estimate: 2500, observed: 2500, confidence: 1, avgIntake: 2500, trendKgPerWeek: 0, bounded: false })
  })

  it('adds the energy of a steady loss back onto intake', () => {
    // 0.5 kg/week loss on 2000 kcal/day -> 2000 + (0.5/7) * 7700 = 2550
    const result = estimateTdee({ dailyIntake: intake(28, 2000), weighIns: weighIns(EVERY_OTHER_DAY, d => 90 - (0.5 / 7) * d), formulaTdee: 2400, calorieTarget: 2000 })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.estimate).toBe(2550)
      expect(result.trendKgPerWeek).toBe(-0.5)
    }
  })

  it('stays close under day-to-day water noise', () => {
    const result = estimateTdee({
      dailyIntake: intake(28, 2000),
      weighIns: weighIns(EVERY_OTHER_DAY, d => 90 - (0.5 / 7) * d + (d % 4 === 0 ? 0.3 : -0.3)),
      formulaTdee: 2400,
      calorieTarget: 2000,
    })
    expect(result.status === 'ready' && Math.abs(result.estimate - 2550)).toBeLessThanOrEqual(60)
  })

  it('excludes days logged at under half the calorie target', () => {
    const result = estimateTdee({
      dailyIntake: [...intake(20, 2400), ...intake(5, 500, 20)],
      weighIns: weighIns(EVERY_OTHER_DAY, () => 80),
      formulaTdee: 2400,
      calorieTarget: 2000,
    })
    expect(result).toMatchObject({ status: 'ready', avgIntake: 2400 })
  })

  it('blends toward the formula at partial confidence', () => {
    // confidence = (14/21) * (13/21) = 0.4127 -> 0.4127*2600 + 0.5873*2200 = 2365
    const result = estimateTdee({ dailyIntake: intake(14, 2600), weighIns: weighIns([0, 4, 8, 13], () => 80), formulaTdee: 2200, calorieTarget: null })
    expect(result).toMatchObject({ status: 'ready', observed: 2600, estimate: 2365 })
    expect(result.status === 'ready' && result.confidence).toBeCloseTo(0.4127, 3)
  })

  it('bounds an implausible estimate to 1.4x the formula', () => {
    const result = estimateTdee({ dailyIntake: intake(28, 4000), weighIns: weighIns(EVERY_OTHER_DAY, () => 80), formulaTdee: 2000, calorieTarget: null })
    expect(result).toMatchObject({ status: 'ready', estimate: 2800, bounded: true })
  })

  it('reports what is missing below the thresholds', () => {
    const result = estimateTdee({ dailyIntake: intake(9, 2000), weighIns: weighIns([0, 2, 4], () => 80), formulaTdee: 2200, calorieTarget: null })
    expect(result).toEqual({ status: 'insufficient', missing: { loggedDays: 1, weighIns: 1, weighInSpanDays: 6 } })
  })

  it('requires full confidence when there is no formula TDEE', () => {
    const partial = estimateTdee({ dailyIntake: intake(14, 2600), weighIns: weighIns([0, 4, 8, 13], () => 80), formulaTdee: null, calorieTarget: null })
    expect(partial).toEqual({ status: 'insufficient', missing: { loggedDays: 7, weighIns: 0, weighInSpanDays: 8 } })

    const full = estimateTdee({ dailyIntake: intake(28, 2600), weighIns: weighIns(EVERY_OTHER_DAY, () => 80), formulaTdee: null, calorieTarget: null })
    expect(full).toMatchObject({ status: 'ready', estimate: 2600, bounded: false })
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/shared/lib/adaptive-tdee.test.ts`
Expected: FAIL, module not found.

**Step 3: Implement**

```ts
// shared/lib/adaptive-tdee.ts

export type TdeeEstimate =
  | { status: 'insufficient', missing: { loggedDays: number, weighIns: number, weighInSpanDays: number } }
  | {
      status: 'ready'
      estimate: number
      observed: number
      formulaTdee: number | null
      confidence: number
      avgIntake: number
      trendKgPerWeek: number
      bounded: boolean
    }

export interface TdeeEstimateInput {
  dailyIntake: { date: string, calories: number }[]
  weighIns: { date: string, weightKg: number }[]
  formulaTdee: number | null
  calorieTarget: number | null
}

export const KCAL_PER_KG = 7700
export const WINDOW_DAYS = 28
const MIN_LOGGED_DAYS = 10
const MIN_WEIGH_INS = 4
const MIN_WEIGH_IN_SPAN_DAYS = 10
const FULL_CONFIDENCE_DAYS = 21
const INCOMPLETE_DAY_FRACTION = 0.5
const LOWER_BOUND = 0.7
const UPPER_BOUND = 1.4

const MS_PER_DAY = 86_400_000
const dayNumber = (value: string) => Math.floor(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / MS_PER_DAY)

// Least squares over raw weigh-ins. The regression averages out water noise on its own; an
// EWMA in front of it was tried in design and biased a 28-day slope ~30% low from lag.
export const weightSlopeKgPerDay = (weighIns: { date: string, weightKg: number }[]): number => {
  if (weighIns.length < 2) return 0
  const points = weighIns.map(w => ({ x: dayNumber(w.date), y: w.weightKg }))
  const meanX = points.reduce((s, p) => s + p.x, 0) / points.length
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length
  const denominator = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0)
  if (denominator === 0) return 0
  return points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0) / denominator
}

export const estimateTdee = (input: TdeeEstimateInput): TdeeEstimate => {
  const { formulaTdee, calorieTarget } = input
  const incompleteBelow = (calorieTarget ?? formulaTdee ?? 0) * INCOMPLETE_DAY_FRACTION
  const loggedDays = input.dailyIntake.filter(d => d.calories >= incompleteBelow)

  const days = input.weighIns.map(w => dayNumber(w.date))
  const spanDays = days.length === 0 ? 0 : Math.max(...days) - Math.min(...days)

  // Without a formula to blend toward, only a full-confidence window is trustworthy.
  const neededDays = formulaTdee === null ? FULL_CONFIDENCE_DAYS : MIN_LOGGED_DAYS
  const neededSpan = formulaTdee === null ? FULL_CONFIDENCE_DAYS : MIN_WEIGH_IN_SPAN_DAYS
  const missing = {
    loggedDays: Math.max(0, neededDays - loggedDays.length),
    weighIns: Math.max(0, MIN_WEIGH_INS - input.weighIns.length),
    weighInSpanDays: Math.max(0, neededSpan - spanDays),
  }
  if (missing.loggedDays > 0 || missing.weighIns > 0 || missing.weighInSpanDays > 0) return { status: 'insufficient', missing }

  const avgIntake = loggedDays.reduce((s, d) => s + d.calories, 0) / loggedDays.length
  const slope = weightSlopeKgPerDay(input.weighIns)
  const observed = avgIntake - slope * KCAL_PER_KG
  const confidence = Math.min(1, loggedDays.length / FULL_CONFIDENCE_DAYS) * Math.min(1, spanDays / FULL_CONFIDENCE_DAYS)

  let estimate = formulaTdee === null ? observed : confidence * observed + (1 - confidence) * formulaTdee
  let bounded = false
  if (formulaTdee !== null) {
    const clamped = Math.min(UPPER_BOUND * formulaTdee, Math.max(LOWER_BOUND * formulaTdee, estimate))
    bounded = clamped !== estimate
    estimate = clamped
  }

  return {
    status: 'ready',
    estimate: Math.round(estimate),
    observed: Math.round(observed),
    formulaTdee,
    confidence,
    avgIntake: Math.round(avgIntake),
    trendKgPerWeek: Math.round(slope * 7 * 100) / 100,
    bounded,
  }
}
```

Check the "no formula, partial" expectation by hand: `neededDays` 21 − 14 logged = 7;
weigh-ins 4 ≥ 4 → 0; span 13 vs 21 → 8. ✓

**Step 4: Run to verify pass**

Run: `npx vitest run tests/shared/lib/adaptive-tdee.test.ts`
Expected: PASS (10 tests). If "adds the energy of a steady loss" is off by 1 from floating
point, it is still an exact line, so check `Math.round` placement rather than loosening the
test.

**Step 5: Commit**

```bash
git add shared/lib/adaptive-tdee.ts tests/shared/lib/adaptive-tdee.test.ts
git commit -m "feat(nutrition): estimate TDEE from logged intake and weight trend"
```

---

### Task 2: Repository queries and the dismissal column

**Files:**
- Modify: `server/repositories/meal-log.repository.ts` (`dailyCaloriesInRange`)
- Modify: `server/repositories/body-metrics.repository.ts` (`findWeightsInRange`)
- Modify: `server/database/schema.sql`, `shared/types/profile.types.ts` (`UserProfile`), `server/repositories/profile.repository.ts` (`mapRow`, `setTdeeSuggestionDismissedAt`)
- Tests: `tests/server/repositories/meal-log.repository.test.ts`, `body-metrics.repository.test.ts`, `profile.repository.test.ts`

**Step 1: Write the failing tests**

Follow each file's existing seeding helpers (read the top of each test file first).

```ts
// meal-log.repository.test.ts
  it('sums calories per calendar day in range, omitting days with no meals', async () => {
    await repo.log('user-1', null, [item(300)], 'breakfast')
    await repo.log('user-1', null, [item(500), item(200)], 'lunch')
    // move them onto known days
    await db.execute(`UPDATE meal_logs SET logged_at = '2026-08-01 08:00:00' WHERE id = 1`)
    await db.execute(`UPDATE meal_logs SET logged_at = '2026-08-01 13:00:00' WHERE id = 2`)
    await repo.log('user-1', null, [item(900)], 'dinner')
    await db.execute(`UPDATE meal_logs SET logged_at = '2026-08-03 19:00:00' WHERE id = 3`)

    expect(await repo.dailyCaloriesInRange('user-1', '2026-08-01', '2026-08-29')).toEqual([
      { date: '2026-08-01', calories: 1000 },
      { date: '2026-08-03', calories: 900 },
    ])
  })
```

(`item(calories)` builds a `MealLogItemInput` with that calorie value. Add it if the file lacks one.)

```ts
// body-metrics.repository.test.ts
  it('returns weigh-ins in range, oldest first', async () => {
    for (const [recordedAt, weightKg] of [['2026-07-31T07:00:00.000Z', 81], ['2026-08-02T07:00:00.000Z', 80], ['2026-08-10T07:00:00.000Z', 79.5]] as const) {
      await repo.record('user-1', { recordedAt, weightKg, source: 'manual', measurements: [] })
    }
    expect(await repo.findWeightsInRange('user-1', '2026-08-01', '2026-08-29')).toEqual([
      { date: '2026-08-02T07:00:00.000Z', weightKg: 80 },
      { date: '2026-08-10T07:00:00.000Z', weightKg: 79.5 },
    ])
  })
```

```ts
// profile.repository.test.ts
  it('stores when the TDEE suggestion was dismissed', async () => {
    // (after the file's usual profile upsert for user-1)
    await repo.setTdeeSuggestionDismissedAt('user-1', '2026-09-14 10:00:00')
    expect((await repo.findByUserId('user-1'))!.tdeeSuggestionDismissedAt).toBe('2026-09-14 10:00:00')
  })
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/meal-log.repository.test.ts tests/server/repositories/body-metrics.repository.test.ts tests/server/repositories/profile.repository.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
  // Adaptive TDEE input: one row per day that has any logged meal. `start`/`end` are
  // YYYY-MM-DD; logged_at is "YYYY-MM-DD HH:MM:SS", so plain string comparison bounds it.
  async dailyCaloriesInRange(userId: string, start: string, end: string): Promise<{ date: string, calories: number }[]> {
    const result = await this.db.execute({
      sql: `SELECT date(ml.logged_at) AS day, SUM(mli.calories) AS calories
            FROM meal_logs ml
            JOIN meal_log_items mli ON mli.meal_log_id = ml.id
            WHERE ml.user_id = ? AND ml.logged_at >= ? AND ml.logged_at < ?
            GROUP BY day
            ORDER BY day`,
      args: [userId, start, end],
    })
    return result.rows.map(row => ({ date: row.day as string, calories: row.calories as number }))
  }
```

```ts
  async findWeightsInRange(userId: string, start: string, end: string): Promise<{ date: string, weightKg: number }[]> {
    const result = await this.db.execute({
      sql: 'SELECT recorded_at, weight_kg FROM body_metrics WHERE user_id = ? AND recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at',
      args: [userId, start, end],
    })
    return result.rows.map(row => ({ date: row.recorded_at as string, weightKg: row.weight_kg as number }))
  }
```

`schema.sql` (append near the other `user_profiles` ALTERs):

```sql
ALTER TABLE user_profiles ADD COLUMN tdee_suggestion_dismissed_at TEXT;
```

`UserProfile` gains `tdeeSuggestionDismissedAt: string | null`; `mapRow` maps it;

```ts
  async setTdeeSuggestionDismissedAt(userId: string, at: string): Promise<void> {
    await this.db.execute({ sql: 'UPDATE user_profiles SET tdee_suggestion_dismissed_at = ? WHERE user_id = ?', args: [at, userId] })
  }
```

Fix any test fixtures that construct a full `UserProfile` literal (`npx nuxi typecheck` will list them).

**Step 4: Run to verify pass**

Run: same as Step 2. Expected: PASS.

**Step 5: Commit**

```bash
git add server/repositories/meal-log.repository.ts server/repositories/body-metrics.repository.ts server/repositories/profile.repository.ts server/database/schema.sql shared/types/profile.types.ts tests/server/repositories
git commit -m "feat(nutrition): query daily calories and weigh-ins for TDEE estimation"
```

---

### Task 3: `TdeeEstimateService` and routes

**Files:**
- Create: `server/services/tdee-estimate.service.ts`
- Create: `tests/server/services/tdee-estimate.service.test.ts`
- Create: `server/api/nutrition/tdee-estimate.get.ts`, `server/api/nutrition/tdee-estimate/dismiss.post.ts`
- Modify: `shared/types/nutrition.types.ts` (`TdeeEstimateResponse`)

**Step 1: Types**

```ts
// shared/types/nutrition.types.ts
import type { TdeeEstimate } from '~~/shared/lib/adaptive-tdee'

export type TdeeEstimateResponse = TdeeEstimate & {
  suggestedTarget: MacroTarget | null
  shouldSuggest: boolean
}
```

**Step 2: Write the failing tests**

```ts
// tests/server/services/tdee-estimate.service.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { TdeeEstimateService } from '~~/server/services/tdee-estimate.service'

const NOW = new Date('2026-09-14T12:00:00Z')

describe('TdeeEstimateService', () => {
  let db: Client
  let profiles: ProfileRepository
  let service: TdeeEstimateService
  let formulaTdee: number | null

  const seedData = async (calories: number) => {
    const meals = new MealLogRepository(db)
    const metrics = new BodyMetricsRepository(db)
    for (let i = 0; i < 28; i++) {
      const date = new Date(NOW)
      date.setUTCDate(date.getUTCDate() - i)
      const iso = date.toISOString().slice(0, 10)
      const log = await meals.log('user-1', null, [{ ingredientId: 1, ingredientName: 'Food', quantity: 1, calories, proteinG: 0, carbsG: 0, fatG: 0 }], 'lunch')
      await db.execute({ sql: 'UPDATE meal_logs SET logged_at = ? WHERE id = ?', args: [`${iso} 12:00:00`, log.id] })
      if (i % 2 === 0) await metrics.record('user-1', { recordedAt: `${iso}T07:00:00.000Z`, weightKg: 80, source: 'manual', measurements: [] })
    }
  }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO ingredients (id, user_id, name, unit_type, calories, protein_g, carbs_g, fat_g) VALUES (1, NULL, 'Food', 'count', 1, 0, 0, 0)`)
    profiles = new ProfileRepository(db)
    await profiles.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180, activityLevel: 'moderately_active', primaryGoal: 'maintenance' })
    formulaTdee = 2400
    service = new TdeeEstimateService(
      { userId: 'user-1', roles: [], permissions: [] },
      profiles, new BodyMetricsRepository(db), new MealLogRepository(db),
      { getComputedStats: async () => ({ bmi: 24, tdee: formulaTdee, latestWeightKg: 80 }) },
    )
  })

  it('suggests a target when the estimate differs from the current target by 150+ kcal', async () => {
    await seedData(2800)
    await profiles.setNutritionTarget('user-1', { calories: 2400, proteinG: 180, carbsG: 240, fatG: 80 })

    const result = await service.getEstimate(NOW)

    expect(result).toMatchObject({ status: 'ready', estimate: 2800, shouldSuggest: true })
    expect(result.suggestedTarget?.calories).toBe(2800)
  })

  it('does not suggest when the difference is small', async () => {
    await seedData(2450)
    await profiles.setNutritionTarget('user-1', { calories: 2400, proteinG: 180, carbsG: 240, fatG: 80 })
    expect((await service.getEstimate(NOW)).shouldSuggest).toBe(false)
  })

  it('does not suggest for 14 days after a dismissal', async () => {
    await seedData(2800)
    await service.dismiss(new Date('2026-09-10T12:00:00Z'))
    expect((await service.getEstimate(NOW)).shouldSuggest).toBe(false)
    expect((await service.getEstimate(new Date('2026-09-25T12:00:00Z'))).shouldSuggest).toBe(true)
  })

  it('never suggests without a primary goal', async () => {
    await seedData(2800)
    await db.execute(`UPDATE user_profiles SET primary_goal = NULL WHERE user_id = 'user-1'`)
    expect(await service.getEstimate(NOW)).toMatchObject({ status: 'ready', shouldSuggest: false, suggestedTarget: null })
  })

  it('returns insufficient with no data', async () => {
    expect(await service.getEstimate(NOW)).toMatchObject({ status: 'insufficient', shouldSuggest: false, suggestedTarget: null })
  })
})
```

Intake excludes today, so at `NOW` the seeded window has 27 intake days (confidence is still 1)
and 14 weigh-ins. The dismissal test's second call is at 09-25, when the window (08-28 → 09-25)
holds 18 intake days and 9 weigh-ins spanning 16 days. Confidence = (18/21)·(16/21) ≈ 0.653,
so the estimate is ≈ 0.653·2800 + 0.347·2400 ≈ 2661. With no target set, `shouldSuggest` is true.

Add one more test for the today exclusion: seed the 28 days at 2800 as usual, then log an extra
1500 kcal meal at `NOW` (today, 12:00). The estimate must still be 2800.

**Step 3: Run to verify failure**

Run: `npx vitest run tests/server/services/tdee-estimate.service.test.ts`
Expected: FAIL, module not found.

**Step 4: Implement**

```ts
// server/services/tdee-estimate.service.ts
import { BaseService } from '~~/server/services/base.service'
import type { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import type { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { ProfileService } from '~~/server/services/profile.service'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { TdeeEstimateResponse } from '~~/shared/types/nutrition.types'
import { estimateTdee, WINDOW_DAYS } from '~~/shared/lib/adaptive-tdee'
import { suggestNutritionTarget } from '~~/shared/lib/nutrition-targets'
import { fromSqliteDatetime, toSqliteDatetime } from '~~/server/utils/date'

const SUGGEST_THRESHOLD_KCAL = 150
const DISMISS_SNOOZE_DAYS = 14

const isoDay = (date: Date, offsetDays = 0) => {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export class TdeeEstimateService extends BaseService {
  constructor(
    ctx: RequestContext,
    private profiles: ProfileRepository,
    private bodyMetrics: BodyMetricsRepository,
    private mealLogs: MealLogRepository,
    // Only the formula TDEE is needed; typed narrowly so tests don't build a whole ProfileService.
    private stats: Pick<ProfileService, 'getComputedStats'>,
  ) {
    super(ctx)
  }

  async getEstimate(now: Date = new Date()): Promise<TdeeEstimateResponse> {
    const userId = this.ctx.userId
    const start = isoDay(now, -WINDOW_DAYS)
    const today = isoDay(now)
    const tomorrow = isoDay(now, 1)

    const [profile, computed, dailyIntake, weighIns] = await Promise.all([
      this.profiles.findByUserId(userId),
      this.stats.getComputedStats(),
      // Today is still being logged: a half-logged day that clears the incomplete-day filter
      // would drag the average down, so intake covers the 28 finished days before today.
      this.mealLogs.dailyCaloriesInRange(userId, start, today),
      this.bodyMetrics.findWeightsInRange(userId, start, tomorrow),
    ])

    const currentTarget = profile?.nutritionTarget ?? null
    const estimate = estimateTdee({ dailyIntake, weighIns, formulaTdee: computed?.tdee ?? null, calorieTarget: currentTarget?.calories ?? null })

    if (estimate.status !== 'ready' || !profile?.primaryGoal) {
      return { ...estimate, suggestedTarget: null, shouldSuggest: false }
    }

    const suggestedTarget = suggestNutritionTarget({ tdee: estimate.estimate, goal: profile.primaryGoal })
    const differsEnough = currentTarget === null || Math.abs(suggestedTarget.calories - currentTarget.calories) >= SUGGEST_THRESHOLD_KCAL
    const dismissedAt = profile.tdeeSuggestionDismissedAt ? fromSqliteDatetime(profile.tdeeSuggestionDismissedAt) : null
    const snoozed = dismissedAt !== null && now.getTime() - dismissedAt.getTime() < DISMISS_SNOOZE_DAYS * 86_400_000

    return { ...estimate, suggestedTarget, shouldSuggest: differsEnough && !snoozed }
  }

  async dismiss(now: Date = new Date()): Promise<void> {
    await this.profiles.setTdeeSuggestionDismissedAt(this.ctx.userId, toSqliteDatetime(now))
  }
}
```

Routes (follow `server/api/nutrition/target.post.ts` for structure and `defineRouteMeta`):

```ts
// server/api/nutrition/tdee-estimate.get.ts (handler)
export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const profiles = new ProfileRepository(db)
  const bodyMetrics = new BodyMetricsRepository(db)
  const profileService = new ProfileService(ctx, profiles, bodyMetrics, new UserRepository(db), new TargetRepository(db))
  return new TdeeEstimateService(ctx, profiles, bodyMetrics, new MealLogRepository(db), profileService).getEstimate()
})
```

`dismiss.post.ts`: same construction, `await service.dismiss(); return { success: true }`.
OpenAPI meta: summaries "Estimate TDEE from logged intake and weight trend" and "Snooze the TDEE target suggestion for 14 days".

(Check `ProfileService`'s constructor order in `server/api/profile/index.get.ts` and copy it exactly.)

**Step 5: Run to verify pass**

Run: `npx vitest run tests/server/services/tdee-estimate.service.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add server/services/tdee-estimate.service.ts server/api/nutrition/tdee-estimate.get.ts server/api/nutrition/tdee-estimate shared/types/nutrition.types.ts tests/server/services/tdee-estimate.service.test.ts
git commit -m "feat(nutrition): serve a TDEE estimate and target suggestion with a 14-day snooze"
```

---

### Task 4: Client composables

**Files:**
- Create: `app/composables/useTdeeEstimate.ts`, `app/composables/useDismissTdeeSuggestion.ts`
- Modify: `app/composables/query-keys.ts`, `app/composables/useSetNutritionTarget.ts`, `app/composables/useLogMeal.ts`, `app/composables/useRecordBodyMetric.ts`

**Step 1:** `queryKeys.tdeeEstimate: () => ['tdee-estimate'] as const`.

**Step 2:**

```ts
// app/composables/useTdeeEstimate.ts
import type { FetchError } from 'ofetch'
import type { TdeeEstimateResponse } from '~~/shared/types/nutrition.types'
import { useQuery } from '@pinia/colada'

export const useTdeeEstimate = () => {
  const { $api } = useNuxtApp()
  return useQuery<TdeeEstimateResponse, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.tdeeEstimate(),
    query: () => $api<TdeeEstimateResponse>('/api/nutrition/tdee-estimate'),
    staleTime: 10 * 60_000, // a 28-day window barely moves within a session
  })
}
```

```ts
// app/composables/useDismissTdeeSuggestion.ts
import { useMutation, useQueryCache } from '@pinia/colada'

export const useDismissTdeeSuggestion = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()
  return useMutation({
    mutation: () => $api<{ success: boolean }>('/api/nutrition/tdee-estimate/dismiss', { method: 'POST' }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.tdeeEstimate() }),
  })
}
```

**Step 3:** Add `queryCache.invalidateQueries({ key: queryKeys.tdeeEstimate() })` to the
`onSuccess` of `useSetNutritionTarget`, `useLogMeal` (and `useEditMeal`, `useDeleteMealLog`,
`useLogPresetMeal`) and `useRecordBodyMetric`.

**Step 4:** `npx nuxi typecheck`, then commit:

```bash
git add app/composables
git commit -m "feat(nutrition): add TDEE estimate query and dismissal mutation"
```

---

### Task 5: Nutrition suggestion card and Profile estimate

**Files:**
- Create: `app/components/nutrition/TdeeSuggestionCard.vue`
- Modify: `app/pages/nutrition.vue` (Today tab, top of `<section v-if="tab === 'today'">`)
- Modify: `app/pages/profile.vue` (next to the TDEE stat)

**Step 1: Card**

```vue
<script setup lang="ts">
import { Button } from "@/components/ui/button";

const { data: estimate } = useTdeeEstimate();
const setTarget = useSetNutritionTarget();
const dismiss = useDismissTdeeSuggestion();

const ready = computed(() => (estimate.value?.status === "ready" && estimate.value.shouldSuggest ? estimate.value : null));
const trendLabel = computed(() => {
  if (!ready.value) return "";
  const t = ready.value.trendKgPerWeek;
  return `${t > 0 ? "+" : t < 0 ? "−" : "±"}${Math.abs(t)} kg/week`;
});

const accept = async () => {
  if (ready.value?.suggestedTarget) await setTarget.mutateAsync(ready.value.suggestedTarget);
};
</script>

<template>
  <UiCard v-if="ready" class="space-y-3">
    <p class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">From your logs</p>
    <p class="text-sm text-foreground">
      Your intake and weight suggest maintenance is about
      <span class="font-semibold">{{ ready.estimate.toLocaleString() }} kcal</span>
      <template v-if="ready.formulaTdee"> (the formula said {{ Math.round(ready.formulaTdee).toLocaleString() }})</template>.
    </p>
    <p class="font-mono text-xs text-muted-foreground">
      Avg {{ ready.avgIntake.toLocaleString() }} kcal/day · trend {{ trendLabel }}
    </p>
    <div class="flex gap-2">
      <Button class="flex-1" :disabled="setTarget.isLoading.value" @click="accept">
        Update target to {{ ready.suggestedTarget?.calories.toLocaleString() }}
      </Button>
      <Button variant="ghost" :disabled="dismiss.isLoading.value" @click="dismiss.mutate()">Not now</Button>
    </div>
  </UiCard>
</template>
```

**Step 2:** In `nutrition.vue`, render `<NutritionTdeeSuggestionCard v-if="isViewingToday" />` as
the first child of the Today section. (Nuxt names `components/nutrition/TdeeSuggestionCard.vue`
`NutritionTdeeSuggestionCard`. Confirm the `components` config in `nuxt.config.ts` doesn't set
`pathPrefix: false`; if it does, use `<TdeeSuggestionCard />`.)

**Step 3: Profile.** Beside the existing TDEE value:

```vue
<p v-if="tdeeEstimate?.status === 'ready'" class="text-xs text-muted-foreground">
  Estimated {{ tdeeEstimate.estimate.toLocaleString() }} kcal · from your data
</p>
<p v-else-if="tdeeEstimate?.status === 'insufficient'" class="text-xs text-muted-foreground">
  {{ insufficientCopy }}
</p>
```

```ts
const { data: tdeeEstimate } = useTdeeEstimate();
const insufficientCopy = computed(() => {
  if (tdeeEstimate.value?.status !== "insufficient") return "";
  const { loggedDays, weighIns, weighInSpanDays } = tdeeEstimate.value.missing;
  const parts = [
    loggedDays > 0 ? `${loggedDays} more day${loggedDays === 1 ? "" : "s"} of meals` : null,
    weighIns > 0 ? `${weighIns} more weigh-in${weighIns === 1 ? "" : "s"}` : null,
    weighIns === 0 && weighInSpanDays > 0 ? `weigh-ins spread over ${weighInSpanDays} more day${weighInSpanDays === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return `Log ${parts.join(" and ")} to personalise this.`;
});
```

**Step 4: Verify manually.** With `npm run db:seed:dummy` (check that its demo user has 28
days of meals and weigh-ins; if not, log a few manually and temporarily lower
`MIN_LOGGED_DAYS` locally, but don't commit that):
- The Nutrition Today tab shows the card when the estimate differs by ≥150 kcal. "Not now" hides it, and it stays hidden after a reload.
- "Update target" sets the target, and the card disappears.
- Profile shows "Estimated … · from your data", or the insufficient copy for a fresh user.

**Step 5: Commit**

```bash
git add app/components/nutrition/TdeeSuggestionCard.vue app/pages/nutrition.vue app/pages/profile.vue
git commit -m "feat(nutrition): suggest a data-driven calorie target and show estimated TDEE on profile"
```

---

### Task 6: Final verification

1. `npx vitest run`: all pass.
2. `npx nuxi typecheck` / `npx eslint .`: clean.
3. README Onboarding & profile → "Derived targets": add "…and, once 10+ days of meals and 4+ weigh-ins exist, a data-driven TDEE estimate (intake minus weight-trend energy, blended toward the formula at low confidence) offered as a one-tap target update."
4. `git add README.md && git commit -m "docs: describe adaptive TDEE"`.
