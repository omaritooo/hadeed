# Today Card Enrichment — Design

## Problem

The Workouts landing page's "Today" card lists today's exercises as plain text
(`app/pages/workouts/index.vue`, the `v-else-if="summary?.todaysWorkout"` branch):
name plus target sets×reps, nothing else. Compared to reference gym apps (Hevy,
Strong), this reads as bare — no visual identification of the exercise, no
sense of what you did last time, no way to drill in without starting the
workout first.

## Scope

Enrich each exercise row on the Today card only. Does not touch:

- Which day is chosen as "today's workout" (existing rotation logic in
  `WorkoutsService.buildTodaysWorkout` is unchanged).
- The split builder (create/edit split) — separate, larger effort, designed
  separately and deferred until this ships.
- Recent PRs / Recent Sessions sections — unchanged.

## Approach

Enrich `TodaysWorkoutExercise` server-side with three new fields, computed
once per page load (no client-side waterfall), and reuse the already-built
`ExerciseDetailDrawer` for full detail on tap instead of building a second
detail view.

```ts
export interface TodaysWorkoutExercise {
  // ...existing fields
  thumbnailUrl: string | null
  primaryMuscle: string | null
  lastPerformed: { weightKg: number, reps: number, date: string } | null
}
```

### Backend

- `ExerciseRepository.findByIds(ids: string[]): Promise<Exercise[]>` (new) —
  batched fetch of full `Exercise` records (name, images, primary/secondary
  muscles) via the existing `attachDetails` helper. Replaces the
  name-only `findNamesByIds` call inside `buildTodaysWorkout`.
- `SessionRepository.findLastPerformedForExercises(userId, exerciseIds:
  string[]): Promise<Record<string, { weightKg: number, reps: number, date:
  string }>>` (new) — one batched query returning, per exercise id, the top
  set (heaviest, then most reps as tiebreak — matching the existing
  `personalRecord` reduction logic in `exercises/[id]/history.get.ts`) from
  the caller's single most recent session that logged it. Exercises with no
  logged history are simply absent from the returned map.
- `WorkoutsService.buildTodaysWorkout`: fetch `findByIds` and
  `findLastPerformedForExercises` in parallel (alongside the existing
  lookups), and map each `SplitExercise` into the enriched
  `TodaysWorkoutExercise`:
  - `thumbnailUrl`: `exercise.images[0] ?? null`
  - `primaryMuscle`: `exercise.primaryMuscles[0] ?? null`
  - `lastPerformed`: `lastPerformedById[exercise.exerciseId] ?? null`

### Frontend

`app/pages/workouts/index.vue`, Today card exercise list:

- Replace the `<li>` list with a row per exercise: thumbnail (`NuxtImg`,
  falls back to a generic dumbbell icon when `thumbnailUrl` is null, same
  fallback pattern already used elsewhere for missing images), exercise
  name, muscle chip (`primaryMuscle`, hidden if null), target sets×reps on
  the right.
- Second line, muted text: `Last: {weight} × {reps} ({relative date})` when
  `lastPerformed` is present. **Omitted entirely (no placeholder line) when
  there's no history** — row is simply shorter for never-logged exercises.
- Tapping a row opens the existing `ExerciseDetailDrawer` (already extracted
  as a shared component with a documented "mount one shared instance, pass
  exerciseId" usage contract) instead of building new detail UI.
- Weight formatting reuses the page's existing `formatWeight` (kg/lbs based
  on `useProfile`), date reuses `formatHistoryDate`.

## Error handling

- Missing image / muscle data: both are already-nullable in the `Exercise`
  type today (free-exercise-db entries aren't all fully populated) — render
  the icon fallback / hide the chip, no error state needed.
- No logged history for an exercise: not an error, just an absent map entry
  → line omitted (see above).

## Testing

Matches this codebase's existing convention (repository/service level only,
no frontend or API-route test infra):

- `ExerciseRepository.findByIds` — repository test: returns full details
  (images, muscles) for a batch of ids, empty array short-circuits to `[]`.
- `SessionRepository.findLastPerformedForExercises` — repository test:
  correct top-set tiebreak (weight then reps), only the most recent session
  per exercise counted, exercises with no logs absent from the result map.
- `WorkoutsService.buildTodaysWorkout` — service test: enriched fields
  threaded through correctly, including the "no history" case producing
  `lastPerformed: null`.
