# Meal check mode & nutrition/home UX — design

## Goal

Add a way to weigh up whether a meal fits your macros *without* logging it, and close three
UX gaps agreed alongside it: native number-input controls, thin home-page content, and the
content of the nutrition/hydration cards.

Four independent pieces, grouped because they overlap the same files
(`app/pages/nutrition.vue`, `app/pages/index.vue`, `app/components/ui/`).

---

## 1. Meal check mode

### Goal

While building a meal in the existing drawer, answer "does this fit in what I have left
today?" — reading the answer, not writing a log row. No persistence, no new endpoints, no
schema change.

### Approach

A mode toggle on the **existing** meal drawer in `app/pages/nutrition.vue`, rather than a
new tab or route. The question ("does this fit?") occurs while you are already composing
the meal, so the answer belongs where you are standing. Everything above the drawer footer
— ingredient combobox, quantity input, item list, running totals — is byte-identical
between modes; only the fit panel and the footer differ.

Two alternatives were considered and rejected:

- **A fourth "Plan" tab.** The tab bar is hardcoded `grid-cols-3` with a `w-1/3`
  indicator, and four tabs is tight at phone width. Rejected for cost vs. benefit.
- **A separate `/nutrition/plan` route.** More room, but it puts the check further from
  the compose step it belongs to.

### State

One addition to the drawer's existing state block:

```ts
const drawerMode = ref<'log' | 'check'>('log')
```

Rendered as a segmented control at the top of the drawer, shown only when
`editingMealLogId === null` — checking a meal you have already eaten is meaningless.

Two existing places must account for it:

- `watch(logDrawerOpen)` already resets every draft field on close; `drawerMode` resets to
  `'log'` there too. Without this the drawer reopens in Check mode after any check.
- `openEditMeal` forces `drawerMode = 'log'`.

### The fit computation

Pure, and therefore extracted to `shared/lib/meal-fit.ts` rather than living in the
component — matching `shared/lib/nutrition-targets.ts` and `shared/lib/formulas.ts`. This
repo does not unit-test Vue components, so logic left in the SFC would have no coverage at
all.

```ts
export interface MacroFit {
  consumed: number   // already eaten today
  meal: number       // what the draft adds
  projected: number  // consumed + meal
  target: number
  overBy: number     // 0 when it fits
  fits: boolean
}

export const evaluateMealFit = (input: {
  totals: MacroTarget          // nutrition.totals
  meal: MacroTarget            // draftTotals
  target: MacroTarget | null   // nutrition.target
}): Record<keyof MacroTarget, MacroFit> | null   // null when no target is set
```

### The fit panel

Below the existing totals strip, in check mode only.

- **A verdict line**: "Fits — 340 cal and 12g protein left", or "Over by 210 cal".
- **A stacked bar per macro**: solid segment for `consumed`, lighter segment for `meal`,
  against the `target` width; overflow in `destructive`.

Reuses `remainingLabel` and `macroPct`, both already defined in `nutrition.vue`.

### Footer

In check mode the primary `Log meal` button becomes a secondary `Log it anyway`, so a
"yes, it fits" answer does not strand the user. `Save as preset` is unchanged.

### Edge cases

- **No target set.** `evaluateMealFit` returns `null`; the panel degrades to the plain
  totals strip plus a "set a target" link. It must **keep showing the macros** — the
  inverse of the existing home-card bug in §3, where the macro row is hidden precisely
  when no target exists.
- **Past days.** The drawer reads whichever day the Today tab is on, so on a past day it
  answers "would this have fit". Harmless, and it falls out of the existing
  `useNutritionToday(selectedDate)` wiring for free rather than needing a guard.

### Deferred

**Day nutrition presets** — composing a whole day and checking it against targets. This
option has no natural home for them; the Presets tab is the obvious place, as a second
kind of preset. Explicitly out of scope here, not precluded by it.

---

## 2. Number-input controls

### Problem

No spinner-suppressing CSS exists anywhere in the codebase — `app/assets/css/index.css`
has no `appearance: textfield` and no `::-webkit-inner-spin-button` rule. Every
`type="number"` therefore renders native increment/decrement arrows. Nine sites are
affected; the worst is `UiMetricInput`, where the arrows float over a centred 2xl value,
and `UiNumberStepper`, which has its own +/− buttons *and* the native ones.

### Approach

A single global rule in `app/assets/css/index.css` covering
`::-webkit-outer-spin-button`, `::-webkit-inner-spin-button` and Firefox's
`appearance: textfield`. One edit, all nine sites, no component churn.

---

## 3. Home page content

### Problem

`server/services/home.service.ts` returns `recentPrs`, `recentAchievements` and
`streak.longest`. `app/pages/index.vue` references **none** of them — zero grep hits. The
data is already on the wire and discarded.

Separately, the hero slot is `v-if activeSession` / `v-else-if todaysWorkout` with **no
`v-else`**. On a rest day, or before a split exists, the largest card on the page silently
vanishes. With `consistency`, `weightGoal`, `weeklyProgress` and `lastSession` all
conditional too, a new or resting user sees a nearly empty page.

### Approach

In dependency order, cheapest first:

1. Surface `recentPrs` ("New PR: 100kg Bench Press") and `recentAchievements`.
2. Show `streak.longest` alongside the current streak, to give it scale ("7 days · best 23").
3. Add the missing `v-else` hero state: rest day, or no split yet, with the next scheduled
   session named.

---

## 4. Nutrition & hydration card content

### Problems

**Nutrition card** (`app/pages/index.vue`):
- Macros render as flat unstyled text with no targets and no progress, while calories get
  a full progress bar. Protein is the number people chase and is the least legible thing
  on the card.
- The macro row sits inside `v-if="nutrition?.target"`, so with no target you see calories
  and *no macros at all* — hiding raw numbers exactly when they are the only thing
  available.
- `Log meal` is a small secondary button at the bottom despite being the card's purpose.
- It says `326 to go`; `nutrition.vue` says `326 left` for the identical value.

**Hydration card** (`app/pages/index.vue`):
- The only progress metric on the page with no progress bar — calories, XP and weight goal
  all have one. It prints a bare `1.2/2.5L`.
- Three presets, a 64px input and an icon button crammed into a half-width column.
- The undo link shifts layout when it appears, and only for 5s.

### Approach

Give macros the same visual treatment as calories; move the macro row outside the target
guard; unify the remaining-label wording between the two files; give hydration a progress
bar; reserve the undo slot so it does not shift layout.

---

## Out of scope

**Bodyweight-anchored protein.** `nutrition-targets.ts` uses a flat 30/40/30
percentage-of-calories split regardless of goal, which gets the cut/bulk case backwards:
an 85kg lifter gets 1.7 g/kg while cutting and 2.6 g/kg while bulking, when protein should
be flat-to-higher in a deficit. The fix is to anchor protein to bodyweight and fat to a
~0.8 g/kg floor, giving carbs the remainder — but it silently rewrites every existing
user's saved target, so it needs its own decision and its own migration story.

## Testing

`shared/lib/meal-fit.ts` gets unit tests under `tests/shared/lib/`, alongside the existing
`nutrition-targets.test.ts` and `formulas.test.ts`. Sections 2-4 are presentational and
carry no tests, per this repo's convention of not unit-testing Vue components.
