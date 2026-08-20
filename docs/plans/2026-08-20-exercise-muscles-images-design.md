# Exercise muscles & images — design

## Problem

`exercise_muscles` and `exercise_images` are already populated by `seed.ts`, but
`ExerciseRepository`/`Exercise` never surface them. Every exercise read comes back
missing `primaryMuscles`, `secondaryMuscles`, and `images`.

## Type change

`Exercise` (`shared/types/exercise.types.ts`) gains three required fields:

```ts
primaryMuscles: string[]   // muscle names, role = 'primary'
secondaryMuscles: string[] // muscle names, role = 'secondary'
images: string[]           // exercise_images.url, ordered by position
```

Required, not optional — every exercise row has a defined (possibly empty) set of
muscles/images, so callers shouldn't have to guard against `undefined`.

## Repository change

`mapRow` is unchanged — it only ever sees a single `exercises` row and can't join.

Add a private `attachDetails(exercises: Exercise[]): Promise<Exercise[]>` on
`ExerciseRepository` that, given a batch of already-mapped exercises:

1. Runs one query joining `exercise_muscles` → `muscles` filtered by
   `WHERE exercise_id IN (...)`, grouping names by `exercise_id` + `role`.
2. Runs one query against `exercise_images` filtered the same way, grouped by
   `exercise_id`, ordered by `position`.
3. Merges both onto each exercise by id (missing entries → empty arrays).

Every `ExerciseRepository` method that returns `Exercise`/`Exercise[]` routes its
result through `attachDetails` before returning, so the type contract holds
everywhere, not just on the currently-used paths:

- `findById` (override `BaseRepository.findById`)
- `findMany` (override — currently unused for exercises, but keep consistent)
- `findByMuscle` (existing custom method)
- `insert` (override — no exercise create path exists today, but keeps the
  contract intact if one is added; muscles/images come back empty unless a
  future caller also writes the join rows)
- `update` (override, same reasoning)

`delete` is untouched (no row is returned).

A single-exercise fetch costs 2 small extra queries (not N+1 per muscle/image).
A multi-exercise fetch (`findByMuscle`, `findMany`) costs the same 2 queries
regardless of how many exercises came back, since both are batched with `IN (...)`.

## Out of scope

- No API/UI changes — this only fixes the data returned by the existing
  `Exercise` shape; `/api/exercises/[id]` and `useExercise` already return
  whatever `Exercise` contains.
- No write path for muscles/images (e.g. an endpoint to edit an exercise's
  muscles) — `insert`/`update` just keep the type contract honest, they don't
  add relation-writing logic.
