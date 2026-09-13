# Week streaks — design

## Goal

Make the streak mean something true, and stop it punishing a single short week. The domain
review flags the streak as too punishing (§22) and "7-Day Streak" as misleading (§23), but
the current code has a more basic problem: it is broken.

## Problems

- **It never resets.** `SessionService.completeSession` hardcodes
  `const missedScheduledDay = false`, so `StreakRepository.reset` is unreachable.
- **It counts weeks but says days.** `GamificationService.onSessionCompleted` calls
  `recordActiveDay` (+1) only when `completedDaysThisWeek === scheduledDaysThisWeek`,
  which happens at most once a week. Home renders it as "Day Streak", and the post-workout
  summary as "N days".
- **Training more than scheduled earns nothing.** A fourth session on a three-day split
  makes `completed !== scheduled`, so no increment.
- **Achievements are denominated in days.** `seed.ts` seeds `streak_length` achievements
  with `{ days: 7 | 30 | 100 }` against a counter that moves weekly.

## Approach

Derive the streak from session history on every read, via a pure
`computeWeekStreak()` in `shared/lib/streak.ts`. There is no stored counter, so there is
nothing to drift, no cron to miss, and existing users get correct numbers immediately,
discarding the inflated values the bug produced.

Two alternatives were considered and rejected:

- **Counter + weekly cron reset** (via the existing GitHub Actions scheduler). Best-effort
  scheduling means a missed run leaves streaks wrong, and existing values still need a
  backfill.
- **Counter + lazy reset on read.** No cron, but "have I already counted this week" state
  is exactly what went wrong here.

## Rules

- **Week**: Monday–Sunday UTC, via the existing `startOfWeek`, consistent with weekly
  volume and the consistency strip.
- **Scheduled count (N)**: non-rest days of the block active on the week's Monday, falling
  back to the block active on its Sunday.
- **Neutral week**: no block, or N = 0. Neither counts nor breaks, so a gap between splits
  doesn't wipe the streak.
- **Completed count**: distinct days with a completed session, matching
  `countTrainedDaysInRange`. Two sessions in one day count once. Extra sessions beyond N
  are fine.
- **Hit**: completed ≥ `max(1, N − 1)`, a one-session grace per week. On a two-day split
  that means one session suffices, which is accepted.

```ts
export const computeWeekStreak = (
  weeks: { weekStart: string, scheduled: number, completed: number }[],
  currentWeekStart: string,
): {
  current: number
  longest: number
  thisWeek: { completed: number, required: number, scheduled: number }
}
```

- `current` walks backward from the most recent **finished** week, skipping neutral weeks,
  stopping at the first missed week.
- The **in-progress week** adds 1 once it is hit, and never breaks the streak while in
  progress.
- `longest` is a forward pass over the same list.

## Data

- `SessionRepository.completedDaysByWeek(userId)`: one grouped query, with the week start
  computed in SQL as `date(started_at, 'weekday 0', '-6 days')` (Monday), returning
  distinct completed days per week.
- `BlockRepository.findAllForUserWithDays(userId)`: every block the user has had, with
  days, to resolve N for each week.
- `GamificationService.getStreak(userId)` assembles the week list and calls
  `computeWeekStreak`. Home, the session-complete summary and achievement facts all use it.

**Removed:** `StreakRepository`, the streak writes in `onSessionCompleted`, and
`SessionCompletionFacts.missedScheduledDay` / the week counting in
`SessionService.completeSession`. The `streaks` table stays in `schema.sql`, unused.

## Achievements

- `streak_length` criteria become `{ weeks: number }`; `computeProgress` reports unit
  `'weeks'`.
- Re-seeded through `upsertByKey`, keeping keys:

  | Key | Name | Weeks |
  | --- | --- | --- |
  | `week_streak` | First Full Week | 1 |
  | `month_streak` | Four Weeks Strong | 4 |
  | `iron_will` | Iron Quarter | 12 |

- Existing `user_achievements` rows are kept.

## UI

- **Home** streak card: "3 week streak · Best 8", with "2 of 3 this week" beneath.
  `HomeSummary.streak` gains `thisWeek`.
- **Post-workout summary**: the streak card reads in weeks.
- **Achievements page**: progress in weeks.

## Testing

- `tests/shared/lib/streak.test.ts`: the grace rule at N = 1, 2 and 5; neutral weeks
  between hit weeks; an in-progress week that is and isn't yet hit; `longest` exceeding
  `current`; N changing when the block changes.
- Repository test for `completedDaysByWeek`, including a week spanning a year boundary
  and two sessions on one day.
- Gamification service test that streak achievements unlock off the derived value.

## Out of scope

- Per-user time zones for week boundaries (`user_profiles.timezone` exists, unused).
- Streak freezes or other earned forgiveness.
