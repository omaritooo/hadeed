# Adaptive TDEE — design

## Goal

Replace a guess with a measurement. TDEE is currently Mifflin-St Jeor × an activity
multiplier (`shared/lib/formulas.ts`), and the calorie target is derived from it. The
formula is commonly off by 10–20% for an individual (domain review §10). Hadeed already
has both inputs needed to measure it: logged meals and weigh-ins.

## Approach

Estimate TDEE from a smoothed weight trend and logged intake, and **suggest** a target
change the user accepts with one tap. Targets are never rewritten silently: a user may
have set theirs deliberately, and patchy logging would make an automatic change harmful.

**Rejected apply modes:**

- **Auto-apply weekly.** Surprising, and dangerous when logging is patchy.
- **Display only.** Safe but not useful.

**Rejected estimation methods:**

- **Endpoint difference** (first vs last weigh-in). A 1kg water swing over 14 days is
  ~550 kcal/day of error.
- **Regression on cumulative energy balance.** Needs months of clean data, and the result
  is hard to explain.

## The estimate — `shared/lib/adaptive-tdee.ts`

```ts
export type TdeeEstimate =
  | { status: 'insufficient', missing: { loggedDays: number, weighIns: number } }
  | {
      status: 'ready'
      estimate: number        // blended, bounded
      observed: number        // pure data-driven value, before blending/bounds
      formulaTdee: number | null
      confidence: number      // 0..1
      avgIntake: number
      trendKgPerWeek: number
      bounded: boolean        // true when the sanity bound clamped the estimate
    }

export const estimateTdee = (input: {
  dailyIntake: { date: string, calories: number }[]  // last 28 days, logged days only
  weighIns: { date: string, weightKg: number }[]     // last 28 days, plus one earlier to seed the trend
  formulaTdee: number | null
  calorieTarget: number | null
}): TdeeEstimate
```

1. **Drop incomplete days**: intake under 50% of `calorieTarget`, or of `formulaTdee` when
   there's no target.
2. **Gate**: at least 10 logged days, and at least 4 weigh-ins spanning at least 10 days.
   Otherwise return `insufficient` with how many more of each are needed.
3. **Weight trend**: an EWMA over weigh-ins with a gap-adjusted smoothing factor,
   `α_eff = 1 − 0.9^gapDays`, so a weigh-in after a week away moves the trend more than
   one taken the next day.
4. **Slope**: least-squares over the trend points in the window, in kg/day.
5. **Observed TDEE** = `avgIntake − slope × 7700`.
6. **Confidence** = `min(1, loggedDays / 21) × min(1, weighInSpanDays / 21)`.
   **Estimate** = `confidence × observed + (1 − confidence) × formulaTdee`. With no
   `formulaTdee` (no activity level on the profile), `confidence` must be 1, otherwise
   `insufficient`.
7. **Sanity bound**: clamp to `[0.7, 1.4] × formulaTdee`, setting `bounded`.

## Server

- `MealLogRepository.dailyCaloriesInRange(userId, start, end)`: one grouped query summing
  `meal_log_items.calories` by `date(meal_logs.logged_at)`.
- `BodyMetricsRepository.findWeightsInRange(userId, start, end)`: plus the single most
  recent weigh-in before `start`.
- `ALTER TABLE user_profiles ADD COLUMN tdee_suggestion_dismissed_at TEXT;`
- **`GET /api/nutrition/tdee-estimate`** returns the `TdeeEstimate`, plus when ready:
  - `suggestedTarget`: `suggestNutritionTarget({ tdee: estimate, goal })`
  - `shouldSuggest`: `|suggestedTarget.calories − currentTarget.calories| ≥ 150` (or no
    current target), and not dismissed within the last 14 days
- **`POST /api/nutrition/tdee-estimate/dismiss`** sets `tdee_suggestion_dismissed_at`.
- **Accepting** reuses `POST /api/nutrition/target` with `suggestedTarget`.

## UI

- **Nutrition → Today tab**: when `shouldSuggest`, a card:
  "Your logs suggest maintenance is ~2,650 kcal (formula said 2,400)", with
  "23 logged days · trend −0.3 kg/week" beneath, and **Update target** / **Not now**.
- **Profile**: "Estimated TDEE 2,650 · from your data" beside the formula value. When
  insufficient: "Log 6 more days of meals and 2 more weigh-ins to personalise this."

## Testing

`tests/shared/lib/adaptive-tdee.test.ts`:

- Flat weight → estimate equals average intake (at full confidence).
- A constructed 500 kcal/day deficit with a matching weight trend recovers the TDEE within
  tolerance.
- Incomplete days are excluded from the average.
- Blending at partial confidence, and the no-formula full-confidence requirement.
- The sanity bound sets `bounded`.
- Irregular weigh-in gaps.
- Each `insufficient` threshold and its `missing` counts.

Repository tests for `dailyCaloriesInRange` (multiple meals per day, empty days) and
`findWeightsInRange` (including the seed weigh-in).

## Out of scope

- Updating a block's training-day and rest-day macro targets.
- Bodyweight-anchored protein (deferred in `2026-09-10-meal-check-and-ux-design.md`).
