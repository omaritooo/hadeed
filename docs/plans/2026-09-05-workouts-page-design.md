# Workouts page — Design

Date: 2026-09-05
Status: Approved, ready for implementation planning

## Context

`docs/plans/2026-08-21-workout-session-logging-design.md` built the full session/set data model and
API (`SessionRepository`, `SessionService`, `/api/sessions/*`) but explicitly scoped out the client:
"the actual resolution UI is a client-side concern for a later pass, not blocked on anything here." That
pass never happened — `app/pages/workouts.vue` today is a leftover component harness: a single hardcoded
exercise id feeding a drawer (image carousel, PR card, execution steps, muscle map, exercise history)
behind one "Stepper" button. No page was ever assembled around it, and nothing on the frontend calls
`/api/sessions/*` — not even `useStartSession` exists yet.

Separately, the `Builder` nav tab (split/program editing) is being dropped in favor of a `Nutrition` tab.
Split/block creation (`useRecommendedSplits`, `useCreateBlockFromPreset`) isn't wired into any page either
(not even onboarding), so there is currently no in-app way to get an active training block at all —
only the seed script produces one, for dev/test users. This design does not fix that; it explicitly
assumes an active block already exists and treats "no active block" as a simple empty state.

Scope: turn Workouts into the real daily-training-loop page (today's plan, start/resume, log sets,
finish), reusing the already-built exercise-detail drawer as-is. Split/program editing, exercise
search, session-detail drill-down, and the offline mutation queue from §6 of the prior design are all
separate future work, not part of this pass.

## 1. Backend

`HomeService.buildTodaysWorkout`/`buildActiveSession` move out into a new `WorkoutsService`, which
`HomeService` then depends on instead of duplicating the logic — both pages read the same computation.

New `GET /api/workouts` returns:
- `todaysWorkout: TodaysWorkout | null` — moved, unchanged logic.
- `activeSession: ActiveSessionSummary | null` — moved, unchanged logic.
- `recentSessions: RecentSessionSummary[]` — `SessionRepository.findMostRecentCompletedSummary` (hardcoded
  `LIMIT 1`) generalizes into `findRecentCompletedSummaries(userId, limit)`; the old method becomes a
  `limit: 1` call to it, so Home's "Last Session" card and this list share one query.
- `recentPrs: RecentPr[]` — reuses the existing `xp.recentPrs` call already computed for Home.

New frontend composables, following the existing `useMutation`/`useQueryCache` pattern
(`useRecordBodyMetric` is the reference): `useWorkoutsSummary` (query), `useStartSession`,
`useLogSet`, `useEditSetLog`, `useAddExerciseToSession`, `useCompleteSession` (mutations). Per the prior
design, `workout_sessions`/`exercise_logs`/`set_logs` use client-generated UUID ids — `useStartSession`
and the per-set/per-exercise mutations generate their id client-side (`crypto.randomUUID()`) before
calling the API, matching the idempotent-insert behavior `SessionRepository` already implements
server-side. `useEditSetLog` and `useCompleteSession` carry the row's current `version` for optimistic
concurrency; a conflict response surfaces as an error rather than silently discarding the user's input —
building an actual conflict-resolution UI is explicitly out of scope here (per the prior design, that was
always meant to be a later pass), as is the offline mutation queue in §6 of that design. Both composables
assume an online, single-device session for now.

## 2. Workouts landing page (`workouts.vue`)

Replaces the current hardcoded-exercise-drawer stub entirely.

- **Header** — date + page title, matching Home's header treatment.
- **Today card** — the focal point, three states:
  - *Active session in progress*: "Continue [Day Name]" + sets-logged progress
    (`ActiveSessionSummary.setsLogged`); tapping navigates straight into the session route.
  - *No session yet, block active*: the scheduled day's name + exercise list preview (name, target
    sets×reps — no inputs, just the plan), with a "Start Workout" button that calls `useStartSession`
    then navigates to the new session route.
  - *No active block* (`todaysWorkout` is null): plain "No active program" empty state, no split picker.
- **Recent PRs** — a horizontal row of compact cards (exercise name, weight×reps, relative date), styled
  after the existing Personal Record card in the exercise-detail drawer (trophy icon, primary accent) for
  visual continuity rather than a new pattern.
- **Recent Sessions** — a vertical list reusing Home's "Last Session" card shape (day name, duration
  badge, relative time + top lift), repeated for the last several sessions. Non-interactive for now — no
  session-detail route exists to link to yet.

## 3. Session logging screen (`pages/workouts/session/[id].vue`)

A dedicated full-screen route, not a view swapped in on `workouts.vue` — starting a session navigates
here; it persists server-side, so leaving mid-session is just normal back-navigation.

- **Header** — day name, a live elapsed-time counter off `session.startedAt` (same `useNow` pattern
  Home already uses), and a "Finish" button (`useCompleteSession`; navigates back to Workouts on success,
  surfaces an error on a version conflict rather than discarding anything).
- **Exercise list** — one block per exercise (from `findWithLogs`): name + target sets×reps×RPE as a
  header; tapping the name/an info icon opens the **existing exercise-detail drawer component unchanged**
  as a reference overlay (instructions, muscle map, PR, history) — reused, not rebuilt. Below that, a
  set-entry row per set (weight/reps/RPE inputs + log button via `useLogSet`); logged sets render as
  completed rows, editable via `useEditSetLog`.
- **Add Freeform Exercise — deferred.** There is no exercise search/list endpoint today (`server/api/exercises`
  only supports fetch-by-id and history), so this session screen is scoped to only the exercises the split
  day already planned. Adding freeform exercises mid-session is real future work, blocked on a browse/search
  endpoint that doesn't exist yet.

## Explicitly out of scope

1. Split/program creation UI (no Builder tab, no in-app path to an active block) — `todaysWorkout: null`
   just renders an empty state.
2. Freeform exercise search/add mid-session — needs a new exercise browse/search endpoint first.
3. Session-detail drill-down (tapping a Recent Sessions row) — no such page exists yet.
4. The offline mutation queue and conflict-resolution UI from §6 of the 2026-08-21 design — mutations in
   this pass are plain online calls; a version-conflict surfaces as an error, not a resolution flow.
5. Real authentication — unchanged, still the hardcoded `x-user-id` header per the prior design's own
   scope note.
