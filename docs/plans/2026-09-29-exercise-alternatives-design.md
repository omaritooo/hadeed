# Exercise alternatives — design

## Goal

A lifter can plan a backup for any exercise in their split, and switch to it mid-workout when
the planned one isn't possible (bench taken, machine broken). Today a split exercise holds
exactly one `exercise_id` and the session page has no way to change an exercise once started.

## Decisions

- **One optional alternative per split exercise**, chosen in the builder with the existing
  swap sheet (same movement pattern / primary muscle, equipment- and limitation-aware).
- **Swap mid-session, not before starting.** The real trigger is arriving at the station and
  finding it taken, which happens after the workout has started.
- **Only before any set is logged** on that exercise (pending sets count). Mixing two exercises
  in one exercise log would corrupt history and PRs.
- **A swap exchanges `exercise_id` and `alternative_exercise_id` on the exercise log.**
  `exercise_id` is always what was performed, so history, PRs, weekly volume and "last time"
  need no change; swapping again restores the original.

Rejected:

- **Pre-start toggle on the Today card.** Simpler (no new endpoint or outbox op) but can't help
  once the workout is under way.
- **Adding a freeform exercise instead.** Works today, but leaves the planned exercise as
  "skipped" and loses its targets and rest time.

## Data

- `split_exercises.alternative_exercise_id TEXT REFERENCES exercises(id)`, nullable.
- `exercise_logs.alternative_exercise_id TEXT REFERENCES exercises(id)`, nullable, snapshotted
  from the split at session start (like `rest_seconds`), so the session page knows it offline
  and a later split edit doesn't change a running session.

## Builder

`DayExercisePicker` rows get a "+ Alternative" link that opens `ExerciseSwapSheet`; once set it
shows "Alt: <name>" with a remove button. `CreateSplitExerciseInput.alternativeExerciseId` is
written and read by `BlockRepository`, and survives edit mode.

## Starting a session

`TodaysWorkoutExercise` and the start payload carry `alternativeExerciseId`;
`attachExercise` writes it. The suggestion is computed for the primary exercise only.

## Swapping

- Session cards (straight sets and circuit) show "Swap to <alt>" when the log has an
  alternative and no sets.
- The tap enqueues an outbox op `swap_exercise` `{ exerciseLogId, toExerciseId, toExerciseName }`.
  `applyPending` overlays it: exchanges the ids, sets the name, clears the suggestion until the
  server's recomputed one arrives. Two pending swaps of the same log fold into the last; if the
  result is the log's original exercise, both are dropped.
- `POST /api/sessions/[id]/exercises/[logId]/swap` `{ toExerciseId }`: owner check, session in
  progress, no sets on the log. If `exercise_id` already equals `toExerciseId`, returns the log
  unchanged (idempotent replay). If `toExerciseId` isn't the current alternative, or sets exist,
  409. Otherwise exchanges the columns and re-snapshots the progression suggestion for the new
  exercise with the same logic session start uses.

## Out of scope

Preset split alternatives, past-workout logging, swapping after sets are logged.

## Testing

Vitest: outbox fold/cancel and overlay; repository swap (exchange, sets-exist rejection,
idempotent replay); the route. Manual check against a local file DB, never `.env` (production).
