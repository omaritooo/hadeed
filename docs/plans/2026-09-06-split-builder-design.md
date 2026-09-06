# Split builder — create & replace a split — Design

Date: 2026-09-06
Status: Approved, ready for implementation planning

## Context

`/builder` is a 5-line stub. Split/block creation already has full backend support
(`SplitService.createFromScratch`, `SplitService.createFromPreset`, `useRecommendedSplits`,
`useCreateBlock`, `useCreateBlockFromPreset`) but **no UI anywhere calls any of it** — there has never
been a way, in the app itself, to create a split. The one existing entry point
(`app/pages/workouts/index.vue`'s "Build a Program" link, added in `4ca7083`) only appears when the user
has no active program at all, and points at the stub.

This design covers building the actual `/builder` page — both the never-built "create your first split"
flow and, new here, a "replace your current split" flow reachable from the Workouts page once a program
is already active. Editing an *existing* split in place (renaming a day, swapping one exercise, adjusting
a target) is explicitly out of scope for this pass — see "Explicitly out of scope" below. "Modify the
split" in v1 means: build a new one, and it replaces the old one going forward.

## 1. Entry points

- **No active program** (existing): `app/pages/workouts/index.vue`'s empty-state card keeps its
  `NuxtLink to="/builder"`, unchanged.
- **Active program** (new): a small "Edit Split" affordance (pencil/settings icon) next to the day name
  in the Workouts page header, visible whenever `summary.todaysWorkout` exists, linking to `/builder`.

`/builder` itself doesn't need to know which case it was opened from — it always ends the same way
(§4), and if there's no active block yet that step is simply a no-op.

## 2. Page flow

A single page, local component state (no Pinia store — the onboarding store exists because onboarding
data is assembled across route navigations; this flow is one page, so a `reactive` local step object is
enough and avoids leaking half-built split state into a global store):

```
Step 1: Mode        "Use a recommended split"  /  "Build my own"
Step 2a (preset):    recommendation list (pre-filled inputs from profile) → pick one
Step 2b (custom):    day-by-day editor (§3)
Step 3:              name + start date (end date left null — open-ended, matches existing convention)
                     → submit
```

Back navigation between steps is local `v-if` state, not real routes — consistent with how
`OnboardingForm.vue` already handles its steps.

## 3. Custom builder (Step 2b)

- Add/remove/reorder days; each day gets a name, a `dayOfWeek`, a `location` (gym/home), and an
  `isRestDay` toggle (rest days skip the exercise list entirely).
- Per non-rest day: an exercise list, each row picked via a **new** exercise search (below) built on the
  `Combobox` component already added to the repo, plus `targetSets` / `targetReps` / `targetRpe` number
  inputs. `setType` defaults to `'weight_reps'` — the same default `createFromPreset` already uses for
  preset-sourced exercises — with `bodyweight_reps` / `time` selectable per row for exercises that need
  it (mirrors the three set types the session-logging page already renders).
- No day-count or exercise-count minimum/maximum enforced client-side beyond "at least one non-rest day
  with at least one exercise" — the same implicit floor `isComplete` used to check for sessions, just
  applied at design time instead of at log time.

**New backend: exercise search.** Nothing today lists or searches exercises — only `GET /api/exercises/:id`
and its history sibling exist. Add:
- `ExerciseRepository.search(query: string, limit = 30): Promise<Exercise[]>` — `WHERE name LIKE '%'||?||'%'
  ORDER BY name LIMIT ?`, reusing `attachDetails` for muscle/image enrichment exactly like `findByIds`
  does.
- `GET /api/exercises?search=<q>` calling it. Muscle-group filtering (`findByMuscle` already exists) is
  left out of the query params for v1 — name search covers the "modify my split" use case; a filter UI is
  extra surface not needed to unblock this feature.

## 4. Submitting — replacing the active block

`createFromPreset`/`createFromScratch` already accept `startDate`, and `BlockRepository.findActiveForUser`
already picks whichever block has the latest `start_date` — so a new block with `startDate` = today
naturally supersedes an old open-ended one **except** when both share the same `start_date` (edit-twice-
in-one-day), where `ORDER BY start_date DESC LIMIT 1` with no tiebreaker is undefined.

Fix at the source instead of relying on ordering: `SplitService` explicitly retires the current block when
creating a replacement.

- New `SplitService.replaceActiveBlock(input: CreateFromScratchInput | { preset, overrides })`: looks up
  `blocks.findActiveForUser(userId, today)`; if one exists, sets its `end_date` to the day before the new
  block's `start_date`; then creates the new block as today already does. Both writes happen against the
  same `BlockRepository` — no new table, no schema change.
- This also makes the block's own history honest (an old split shows a real `end_date` instead of an
  orphaned open-ended row sitting underneath a newer one), which the current create-only flows never had
  to consider because nothing before this could produce two blocks for one user.
- The two existing `POST /api/blocks` / `POST /api/blocks/from-preset` endpoints gain this retire-then-
  create behavior unconditionally (it's a no-op — nothing to retire — for the "no active program yet"
  case), rather than adding a third `/replace` endpoint for what callers can't tell apart anyway.

## 5. Card redesign (independent of the above)

The exercise cards on the workout session page (`app/pages/workouts/session/[id].vue`) get a visual pass:
clearer separation between the exercise header and its set rows, larger tap targets on the log/check
button, and better use of weight/reps/RPE column alignment. Purely presentational — no data or behavior
change — and not blocked on anything above.

## Explicitly out of scope

- Editing an existing split in place (rename a day, swap one exercise, adjust one target) without
  creating a brand-new block. A real candidate for a later pass once it's clear how often "tweak one
  thing" vs. "replace wholesale" actually happens in practice.
- Muscle-group / equipment filtering in the exercise search UI.
- Any change to session start/completion behavior — `split_day_id` on an in-progress session still points
  at whatever `SplitDay` it was started against; retiring a block doesn't retroactively touch sessions
  already in flight against its days (`ON DELETE SET NULL`/no cascade concerns here since blocks aren't
  deleted, only end-dated).
- Reusing this builder's day/exercise editor as the onboarding flow's split step — onboarding today
  collects only profile data; wiring a split-selection step into onboarding is a separate decision about
  the signup flow, not required to unblock "modify my split" for an existing user.
