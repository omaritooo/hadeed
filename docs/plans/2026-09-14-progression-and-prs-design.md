# Progression suggestions & PR rework — design

## Goal

Close the "Adapt" half of Plan → Perform → Measure → Adapt. Today Hadeed prescribes a
session, logs it, and charts it, but never tells the lifter what to do next time: the
session page shows `Last: 60kg × 8` and leaves the progression decision to them. The
domain review (`hadeed_training_domain_review_and_templates.md` §4, §26, §28) ranks
progression logic the #1 critical gap.

Two pieces, grouped because they read the same data (a lift's prior working sets) and
touch the same files (`session.repository.ts`, the session page, XP):

1. **Progression suggestions** — rep ranges, double progression, RPE autoregulation.
2. **PR rework** — weight / rep / estimated-1RM PRs, and closing two XP holes.

---

## 1. Progression suggestions

### Approach

A pure `suggestProgression()` in `shared/lib/progression.ts`, run server-side at session
start and **snapshotted onto `exercise_logs`** — the same reasoning as the existing
`rest_seconds`, `format` and target snapshots: a past session keeps saying what it
suggested even after later set edits, and it leaves room to measure adherence to
suggestions later. Living in `shared/` means the offline-queue work can run the same
function client-side when a session starts without connectivity.

Two alternatives were considered and rejected:

- **Compute on every session read.** No storage, but a past session's suggestion drifts
  when sets are edited or deleted, and adherence can't be measured.
- **Client-only.** `findExerciseHistory` returns only each session's top set, so a new
  endpoint is needed regardless, and Home / the post-workout summary couldn't use it.

### Data model

**Rep ranges.** `split_exercises`, `preset_split_exercises` and `exercise_logs` replace
`target_reps` with `target_reps_min` / `target_reps_max`. A table-rebuild migration in
`server/database/migrations/` (same shape as `equipment-tiers.ts`) copies the old value
into both. `min = max` is valid and the rules degrade to "hit the target".

**Suggestion snapshot on `exercise_logs`:**

| Column | Type | Notes |
| --- | --- | --- |
| `suggested_weight_kg` | `REAL` | Null for `first_time`, bodyweight and time set types |
| `suggested_reps_min` | `INTEGER` | |
| `suggested_reps_max` | `INTEGER` | |
| `suggestion_action` | `TEXT CHECK IN ('increase','hold','reduce','first_time')` | |
| `suggestion_reason` | `TEXT` | A reason **key**, not prose, so the i18n work can translate it |

**Repository.** `findRecentWorkingSets(userId, exerciseId, sessions = 2)` — every
non-warm-up set from the N most recent *completed* sessions containing the exercise,
grouped by session, newest first. Freeform sessions count. Unlike `findExerciseHistory`,
it returns all sets, not the top set.

**Service.** `POST /api/sessions` currently calls `SessionRepository.startSession`
directly. A new `SessionService.startSession` loads, per exercise, the recent working
sets, the exercise's `equipment` and `movement_pattern`, and the profile's `unit_system`;
calls `suggestProgression`; and passes the result into `attachExercise`.

**Presets.** Preset seed data gains real ranges — compounds 5–8 or 6–10 depending on goal,
isolation 10–15.

### Rules

```ts
export type SuggestionAction = 'increase' | 'hold' | 'reduce' | 'first_time'
export type SuggestionReason =
  | 'first_time' | 'missed_min_twice' | 'rpe_too_high'
  | 'all_sets_top_of_range' | 'rpe_too_low' | 'building_reps'

export const suggestProgression = (input: {
  prescription: { sets: number | null, repsMin: number, repsMax: number, rpe: number | null }
  recentSessions: { weightKg: number | null, reps: number | null, rpe: number | null }[][] // newest first
  setType: 'weight_reps' | 'bodyweight_reps' | 'time'
  equipment: string | null
  movementPattern: string | null
  unitSystem: 'metric' | 'imperial'
}): { action: SuggestionAction, reason: SuggestionReason, weightKg: number | null, repsMin: number, repsMax: number }
```

Evaluated in order; first match wins:

1. **No prior working sets** → `first_time`. No weight; reps = prescribed range.
2. **Last two sessions both had a set below `repsMin`** → `reduce` (`missed_min_twice`):
   working weight −10%, rounded to a loadable increment.
3. **Average logged RPE ≥ target + 1.5** → `hold` (`rpe_too_high`).
4. **Every prescribed set reached `repsMax`**, and average RPE ≤ target + 0.5 or RPE not
   logged → `increase` (`all_sets_top_of_range`); reps reset to `repsMin`.
5. **Average RPE ≤ target − 2 and every set reached `repsMin`** → `increase`
   (`rpe_too_low`).
6. Otherwise → `hold` (`building_reps`).

**Definitions**

- **Working weight**: the heaviest weight used on at least half the working sets, so a
  single heavy top set doesn't define it.
- **RPE**: sets without RPE are ignored when averaging; with no RPE logged, or no RPE
  prescribed, rules 3 and 5 are skipped.
- **"Every prescribed set"**: at least `prescription.sets` working sets were logged
  (or all logged sets, when `sets` is null).
- **Increments** (metric / imperial):

  | Equipment | Pattern | Increment |
  | --- | --- | --- |
  | barbell | knee- or hip-dominant | 5 kg / 10 lb |
  | barbell | other | 2.5 kg / 5 lb |
  | dumbbell | any | 2 kg / 5 lb |
  | anything else | any | 2.5 kg / 5 lb |

- **Rounding**: to the nearest multiple of the increment *in the user's unit*, stored
  back in kg (reusing `kgToLbs` / `lbsToKg`).
- **Bodyweight and time set types** never suggest weight. Rule 4 becomes "increase reps
  by 1–2 above the range" (bodyweight) or holds (time).
- **Circuits**: one round is one set.

### UI

**Session page** (`app/pages/workouts/session/[id].vue`):

- A line under Target/Last: `Today: 62.5kg × 8–10` with an action glyph (↑ = ↓). Tapping
  it reveals one sentence of reason ("All sets hit 10 last time — add 2.5kg").
- When an exercise has no logged sets and its draft is empty, the kg/reps inputs
  pre-fill with the suggested weight and `repsMin`. A fill, not a lock. From set two
  onward, "Same as last set" is unchanged.
- The target label shows the range: `Target: 3×8–10 @ RPE 7`.
- The circuit view shows the same line per exercise row.
- New lines respect the profile's unit system. The page's existing hardcoded `kg` labels
  are a separate fix.

**Builder** (`app/components/builder/`): the reps stepper becomes a min–max pair that
starts equal; the schema enforces `min ≤ max`.

**Post-workout summary**: a "Next time" card listing exercises that will progress
("Bench Press → 65kg"), computed by running `suggestProgression` over the just-finished
sets. Display only, not stored.

---

## 2. PR rework

### Problems

- **Weight-only.** `server/utils/pr.ts` only knows "heavier than ever". Going from 8 to 10
  reps at the same weight, the real signal of double progression, is invisible.
- **First-ever set is a PR.** `previousBestKg === null` returns `true`, so the first set
  of any exercise the user has never done awards 50 XP.
- **Set XP is never awarded.** `GamificationService.onSetLogged` has no caller; the README's
  "10 XP per set" doesn't happen.
- **Delete-and-relog XP farming.** Deleting a set leaves its `xp_ledger` rows, and a new
  set gets a new UUID, so a fake PR can be logged, deleted and re-logged for 50 XP each
  time.
- **PRs have no table.** They exist only as `xp_ledger` rows with `source_type = 'pr'`.

### Data model

```sql
CREATE TABLE IF NOT EXISTS personal_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id    TEXT NOT NULL REFERENCES exercises(id),
  set_log_id     TEXT NOT NULL REFERENCES set_logs(id) ON DELETE CASCADE,
  pr_type        TEXT NOT NULL CHECK (pr_type IN ('weight','reps','e1rm')),
  value          REAL NOT NULL,
  previous_value REAL NOT NULL,
  achieved_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (set_log_id, pr_type)
);
CREATE INDEX IF NOT EXISTS idx_personal_records_user ON personal_records(user_id, achieved_at);
```

### Detection

`shared/lib/personal-records.ts` replaces `server/utils/pr.ts`. It compares a working set
against this exercise's prior working sets:

- **Weight PR**: weight > every prior weight.
- **Rep PR**: reps > every prior set's reps at this weight *or heavier*.
- **e1RM PR**: Epley `w × (1 + r / 30)` > every prior e1RM; only sets with `reps ≤ 12`
  are eligible, on either side of the comparison.
- **No prior working sets → no PR.** The first session sets the baseline.
- Warm-ups are never PRs and never part of the baseline (unchanged).

### XP

- The PR bonus stays 50 XP, awarded once per **set** that hits any PR type
  (`source_id` = set id), not once per type.
- Wire `onSetLogged` into `POST /api/sessions/:id/sets`.
- **Deleting a set** deletes its `set_logged` and `pr` ledger rows; `personal_records`
  rows cascade.
- **Editing a set** deletes its PR rows and PR ledger row, then re-detects.

### Reads

`XpRepository.findPrsForSession`, `GET /api/stats/pr-history`, and Home's recent PRs read
`personal_records` and carry the type ("e1RM 102kg"). A one-off
`npm run db:backfill-prs` replays existing `set_logs` chronologically to populate the
table; existing `xp_ledger` rows are left as they are.

---

## Error handling

- Suggestion computation must not block starting a session. If loading history fails,
  log it and attach the exercise with null suggestion columns. The UI hides the line.
- A session started before this ships has null suggestion columns and renders exactly as
  today.
- PR detection failure after a set is logged is logged and swallowed, as `onPrHit`
  failures are today.

## Testing

- `tests/shared/lib/progression.test.ts`: one case per rule, rule precedence (2 beats 4),
  missing-RPE fallbacks, working-weight selection with a top single, increment table
  and rounding in both unit systems, bodyweight/time set types.
- `tests/shared/lib/personal-records.test.ts`: each PR type, no-history baseline, rep PR
  at a heavier weight, the e1RM 12-rep cap, warm-up exclusion.
- Repository tests against the throwaway libSQL database: `findRecentWorkingSets`, the
  rep-range migration rebuild, and PR/XP cleanup on set delete and edit.
- Service test: `SessionService.startSession` snapshots suggestions, and still starts the
  session when history loading throws.

## Out of scope

- **Deloads and block periodization** (review §5). Rule 2 is a per-lift back-off, not a
  planned deload week.
- **Per-exercise increment overrides** (microplates, 5kg-step machines).
- **Weekly volume management** (review §6).
