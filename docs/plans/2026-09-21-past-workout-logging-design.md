# Past workout logging — design

## Goal

A lifter who trained but didn't log can enter the workout afterwards, dated to the day it
happened. Today every session, set and completion timestamp is `datetime('now')` on the
server, so a workout logged late counts as today — wrong for history, weekly volume and
streaks.

## Decisions

- **Quick form, not the live session screen.** One screen: pick a date and a workout, each
  exercise is one row of `sets × reps @ weight`, save once.
- **Full rewards, 14-day window.** Set XP, PRs, session XP and achievements as for a live
  session, but only for today and the previous 14 days — enough to catch real misses without
  rewriting old history.
- **One dedicated endpoint.** The whole workout goes up in one request and is written in one
  transaction.

Rejected:

- **Optional timestamps on the existing start / log-set / complete endpoints.** ~25 requests
  per workout, a failure midway leaves a half-built past session, and `startSession` expires
  in-progress sessions, so backfilling could abandon a workout that's open. (The offline
  logging design adds client `loggedAt`/`completedAt` to those endpoints for a different
  reason — clock accuracy for a live session — and stays independent of this.)
- **Log normally, then change the date.** Awkward, and PR ordering breaks.

## UI

- **Entry point:** a "Log a past workout" link on `/workouts`, opening `/workouts/log-past`.
- **Date:** today back 14 days.
- **Workout:** the active block's non-rest split days, or Freeform.
- **Rows:** choosing a split day pre-fills its exercises. Sets and reps come from the split
  target, weight from the last time the exercise was performed (`findRecentWorkingSets`),
  shown in the user's unit.
- **Editing:** add an exercise (existing exercise picker) or remove one.
- **Save:** invalidates the workouts, home and stats queries, then returns to `/workouts`.

## Server

`POST /api/sessions/past`

```ts
{
  id: string                  // client UUID, idempotent on replay
  startedAt: string           // ISO datetime, chosen date at the client's current local time
  splitDayId: number | null
  exercises: Array<{
    id: string                // exercise_log id
    exerciseId: string
    splitExerciseId?: number | null
    setType: 'weight_reps' | 'bodyweight_reps' | 'time'
    sets: number              // >= 1
    reps: number | null
    weightKg: number | null
  }>
}
```

**Validation (422):**
- `startedAt` is in the future or more than 14 days ago.
- The exercise list is empty, or an exercise has `sets < 1`.

The split day must belong to the caller (403).

**Writes, one `db.batch(..., 'write')`:**
- `workout_sessions` with `status = 'completed'` and the new `logged_retroactively = 1`.
- The `exercise_logs`, with targets snapshotted from the split exercise as `startSession`
  does.
- One `set_logs` row per set. Sets are stamped `startedAt + 1s, +2s, …` in form order, so
  `(logged_at, rowid)` ordering stays meaningful. `completed_at` is one second after the
  last set.
- Replaying the same `id` returns the existing session.

**Schema:** `ALTER TABLE workout_sessions ADD COLUMN logged_retroactively INTEGER NOT NULL
DEFAULT 0`. Recent Sessions shows "Logged later" instead of a duration, and duration stats
skip these sessions, so synthetic set timing never reads as real data.

## Rewards

These run after the rows commit. Following `SessionService`'s existing rule, a reward
failure is logged and doesn't fail the request.

1. **Per set, in order:** 10 XP, and PR detection against working sets logged before it
   (`findWorkingSetsBefore` + `detectPersonalRecords`), with 50 XP per PR set.
2. **Later sets:** for each exercise in the session, every working set logged *after* the
   session is re-evaluated. Its `personal_records` rows are deleted, its PR XP is revoked,
   and PRs are re-detected in `(logged_at, rowid)` order — the same teardown `editSet` uses.
   Without this, a heavier backdated set would leave a later "PR" standing.
3. **Session:** 25 XP, then `evaluateAchievements`.
4. **Streak:** `recordActiveDay` is not called, because it stamps today's date. The derived
   week streak (`shared/lib/streak.ts`, not yet wired into reads) counts completed days per
   week from `started_at`, so it picks up backdated sessions once wired. Until then, a
   backdated session doesn't change the legacy `streaks` row.

## Testing

**Service tests:**
- Date bounds (future, day 15, today, day 14).
- Ownership of the split day.
- Set timestamp ordering.
- XP totals.
- Idempotent replay.
- A backdated heavier set turning a later weight PR into a non-PR, with its PR XP revoked.
- A backdated lighter set leaving later PRs alone.

**Repository tests:**
- The insert batch.
- `logged_retroactively` surfacing in recent sessions and being excluded from duration.

**Manual:** run the app and log a past workout end to end, then check that history, PRs and
XP match.
