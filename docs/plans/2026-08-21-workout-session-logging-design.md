# Workout session logging (WorkoutSession → ExerciseLog → SetLog) — Design

Date: 2026-08-21
Status: Approved, ready for implementation planning

## Context

Every prior design (`docs/plans/2026-08-18-splits-presets-gamification-design.md`) explicitly deferred
this: `gamification.service.ts` exists, fully implemented, and is called from nowhere — it has been
waiting on `WorkoutSession`/`Set` to exist since it was written. A senior-trainer review of the training
domain (`hadeed_training_domain_review_and_templates.md`) independently converged on the same
conclusion from the other direction: progression, real PR detection, honest XP, adherence-aware
recommendations, and per-muscle volume tracking are all blocked on the same missing piece. This design
is that piece — the first thing the app persists about what a user actually *did*, as opposed to what
they planned to do.

Scope is deliberately narrow: the session/set data model, its lifecycle, its completion rule, and how it
wires into the existing (inert) gamification layer. Progression logic, RPE-based autoregulation, refined
PR-type separation, volume/frequency analysis, exercise substitution, and food logging are all real,
agreed-on future work — each is its own design pass once this exists to build on.

## 1. Data model

`workout_sessions`, `exercise_logs`, and `set_logs` use `TEXT` (client-generated UUID) primary keys,
not `INTEGER PRIMARY KEY AUTOINCREMENT` — the one deliberate departure from this codebase's existing
convention. Reason: offline logging is in scope (see §6), so a set logged with no network connection
needs a stable identity before the server has ever seen it; two devices independently offline cannot be
allowed to both mint `id = 47`.

```sql
CREATE TABLE IF NOT EXISTS workout_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  split_day_id  INTEGER REFERENCES split_days(id) ON DELETE SET NULL,  -- NULL = freeform session
  status        TEXT NOT NULL CHECK (status IN ('in_progress','completed','abandoned')) DEFAULT 'in_progress',
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  version       INTEGER NOT NULL DEFAULT 1   -- optimistic concurrency, see §6
);

CREATE TABLE IF NOT EXISTS exercise_logs (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id        TEXT NOT NULL REFERENCES exercises(id),
  split_exercise_id  INTEGER REFERENCES split_exercises(id),  -- NULL if added freeform mid-session
  position           INTEGER NOT NULL,
  set_type           TEXT NOT NULL CHECK (set_type IN ('weight_reps','bodyweight_reps','time')),
  -- snapshot of split_exercises at session start; NULL for freeform-added exercises
  target_sets        INTEGER,
  target_reps        INTEGER,
  target_rpe         REAL
);

CREATE TABLE IF NOT EXISTS set_logs (
  id               TEXT PRIMARY KEY,
  exercise_log_id  TEXT NOT NULL REFERENCES exercise_logs(id) ON DELETE CASCADE,
  set_number       INTEGER NOT NULL,
  weight_kg        REAL,
  reps             INTEGER,
  rpe              REAL,
  logged_at        TEXT NOT NULL DEFAULT (datetime('now')),
  version          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_table   TEXT NOT NULL,      -- 'set_logs' | 'workout_sessions'
  entity_id      TEXT NOT NULL,
  server_value   TEXT NOT NULL,      -- JSON snapshot of what's currently stored
  proposed_value TEXT NOT NULL,      -- JSON snapshot of the offline client's attempted write
  base_version   INTEGER NOT NULL,   -- the version the client thought it was editing
  detected_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT,
  resolution     TEXT CHECK (resolution IN ('kept_mine','kept_server','manual'))
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_user     ON workout_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_session      ON exercise_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_exercise     ON exercise_logs(exercise_id);
CREATE INDEX IF NOT EXISTS idx_set_logs_exercise_log      ON set_logs(exercise_log_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_user        ON sync_conflicts(user_id, resolved_at);
```

Everything else in the schema (`users`, `exercises`, `blocks`, `preset_splits`, gamification tables)
keeps its existing `INTEGER AUTOINCREMENT` convention unchanged — only the three tables actually written
from the gym floor need client-generatable ids.

## 2. Session lifecycle

- **Start** — creates a `workout_sessions` row (`in_progress`). If `split_day_id` is given, every
  `split_exercises` row for that day is copied into an `exercise_logs` row, snapshotting
  `target_sets`/`target_reps`/`target_rpe` at that moment — later edits to the Block/SplitDay never
  change what a past session's completion looked like. A freeform session (`split_day_id` null) starts
  with zero `exercise_logs`; exercises are added to it as the workout happens.
- **Live logging** — `set_logs` rows are appended to any `exercise_log` at any time, in any order, one
  `POST` per set (not one payload at the end) — this is what makes "log as you go" work.
- **Abandon** — checked lazily (no scheduler exists in this stack): whenever a user starts a new
  session, any of their own `in_progress` sessions older than a 12-hour window are flipped to
  `abandoned` first. Adjustable later; not worth debating further now.
- **Complete** — the finishing action; evaluates the completion rule (§3) and calls into gamification
  (§4).

## 3. Completion rule, and what "freeform counts too" means for the streak

**Planned session** (`split_day_id` set): complete only if every `exercise_log` with a non-null
`split_exercise_id` has at least `target_sets` rows in `set_logs`. Freeform exercises added mid-session
can only add to a session, never cause it to fall short — they aren't compared against anything.

**Freeform session** (`split_day_id` null): complete once it has at least one `set_logs` row anywhere in
it. There's no prescription to fall short of.

**Streak** — reinterpreted from the original design's "every scheduled day, specifically" rule: a
calendar day counts as *trained* if it has at least one `completed` session, planned or freeform. The
week's requirement is still "as many trained days as there are non-Rest `split_days` on the active
Block," but it's satisfied by *any* N trained days that week, not by matching each named day's own plan.
Missing Monday's scheduled Push day but doing an unplanned full-body session instead still keeps the
streak alive. This is a deliberate loosening from the original design doc, made explicitly for this
build, not an oversight.

## 4. Gamification wiring

`SessionService.completeSession` is the first real caller of the gamification layer built in the prior
round. It computes `scheduledDaysThisWeek` (count of non-Rest `split_days` on the user's active Block)
and `completedDaysThisWeek` (count of distinct trained days this week, per §3), and calls
`GamificationService.onSessionCompleted(userId, sessionId, facts)` — the exact shape that method already
expects; nothing about `gamification.service.ts` itself changes.

## 5. Post-completion edits — scoped narrowly

"Editable after completion" means correcting a value on an already-logged `set_logs` row (fix a
mis-typed weight/reps/RPE). It does **not** mean reopening a completed session to add or remove
sets/exercises — a workout done wrong is a new session, not a reopened one. A correction does **not**
retroactively recompute XP, streak, or achievements; those are locked in at the moment the session was
originally completed. This keeps the XP ledger's existing idempotency guarantee intact and avoids a
clawback model nothing in this app currently has — a deliberate trade-off (you can't retroactively earn
a PR by fixing a typo later), not an oversight.

## 6. Offline queue & conflict resolution

Hadeed is a Nuxt **PWA** — a browser sandbox, not a native app with filesystem access. Turso's embedded
libSQL replica pattern (a local SQLite file synced against the remote database) is built for native/edge
contexts and doesn't naturally apply here. The offline story instead uses the standard PWA pattern:

- A service worker holds pending mutations (`start_session`, `log_set`, `add_freeform_exercise`,
  `edit_set`, `complete_session`) in IndexedDB while offline, keyed by the client-generated UUID of the
  entity involved.
- **Inserts can't conflict.** Starting a session, logging a set for the first time, adding a freeform
  exercise — each mints a fresh UUID nobody else could have claimed. Replay is idempotent by primary key
  (already-applied rows are a no-op on retry).
- **Updates can conflict** — only two mutation types are updates here: editing an existing `set_logs`
  row (§5), and completing a session (`workout_sessions.status`). Each queued update carries the
  `version` the client last saw. On replay, the server compares that `baseVersion` to the row's current
  `version`:
  - Match → apply, increment `version`. The overwhelming majority case (one device in use at a time).
  - Mismatch → the row changed elsewhere since this client last saw it (e.g. a session was completed on
    one device while another, still offline, tries to log one more set into what it thinks is still
    in-progress) → don't apply, don't discard. Insert a `sync_conflicts` row holding both the current
    server value and the client's proposed value as JSON, and surface it for the user to resolve
    (keep mine / keep server's / manual) next time the app is open.
- A version counter, not a client timestamp, arbitrates conflicts deliberately — offline device clocks
  drift and skew relative to each other, so timestamp-based last-write-wins is not a reliable arbiter
  here.

## 7. Ownership & new components

- `SessionRepository` — nested writes across `workout_sessions` → `exercise_logs` → `set_logs`, same
  shape as the existing `BlockRepository`; plus the lazy abandon-sweep and the version-checked update
  path for edits/completion.
- `SessionService extends BaseService` — `requireOwner(session.userId)` gates every read/write, same
  pattern as `SplitService.getOwnedBlock`.
- `SyncConflictRepository`/surfacing is scoped to storage + listing only in this design; the actual
  resolution UI is a client-side concern for a later pass, not blocked on anything here.

## Explicitly out of scope (separate future design passes, in this order per prior discussion)

1. Double progression / RPE-based autoregulation, PR detection with weight/rep/e1RM split, honest XP
   tied to completed-vs-planned, per-muscle weekly volume — all now unblocked by this design, but not
   designed here.
2. Curated movement-pattern/difficulty exercise metadata, substitution engine, granular equipment
   inventory, injury/limitation exclusions (the last of these matters sooner than the others, given real
   users other than the developer are expected soon).
3. Food/calorie logging (a new domain — no schema for this exists anywhere today) and weight-trend-based
   TDEE recalibration, which depends on it.
4. Real authentication, replacing the hardcoded `x-user-id` header — deliberately kept out of this round.
