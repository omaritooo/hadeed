# Comprehensive Exercise Engine — Design

Date: 2026-09-07
Status: Approved, ready for implementation planning

## Context

`/Users/omarash27/Desktop/Product Requirement Document & Technical.md` specifies a "hyper-personalized,
biomechanically sound" split builder: exercise tiers, movement-pattern taxonomy, an equipment-fallback
matrix, a weekly volume tracker, a recovery/overuse checker, and an exercise swap sheet. None of this
exists today. The split-builder work just shipped (`docs/plans/2026-09-06-split-builder-design.md`) built
the *mechanics* of creating a split (presets + custom) — this design builds the *exercise-science layer*
the PRD actually asked for, on top of that.

Every non-obvious choice below is grounded in real sports-science sourcing checked during design (NSCA
movement-pattern taxonomy, Renaissance Periodization volume landmarks, published split-frequency
comparisons), not invented — see inline citations. Two things came out of that research that materially
change the PRD's own approach:

1. **Equipment substitution doesn't need a curated "exercise family" table.** The standard coaching
   principle is "match movement pattern + primary muscle," not "here is exercise X's specific fallback
   list." Once every exercise has a movement-pattern tag (Phase 0), the equipment-fallback matrix (Phase 3)
   falls out of a query, not a maintained mapping.
2. **Tier classification is mostly deterministic already.** CNS-fatigue tiering tracks joint complexity
   and stabilizer demand — factors this codebase already has half of, via `mechanic` (compound/isolation)
   and `equipment`. Only compound-dumbbell exercises are genuinely ambiguous between Tier 1 and Tier 2.

## 1. Exercise classification (Phase 0 — blocks Phases 2, 3, 4)

**Movement pattern** — a new `movement_pattern` column on `exercises`, one of: `horizontal_push`,
`vertical_push`, `horizontal_pull`, `vertical_pull`, `knee_dominant`, `hip_dominant`, `elbow_flexion`,
`elbow_extension`, `lateral_isolation`, `core`. Deterministic rule pass, no LLM: `force` (push/pull/static)
narrows the axis, `primaryMuscle` + name-keyword matching (`incline`/`overhead`/`shoulder` → vertical;
`bench`/`row`/`chest press` → horizontal; `squat`/`leg press`/`lunge` → knee-dominant; `deadlift`/`hinge`/
`RDL` → hip-dominant; `curl` → elbow flexion; `extension`/`pushdown`/`dip` → elbow extension) covers the
large majority. A residual bucket (`core`, `lateral_isolation`, and anything the rules don't confidently
match) is fine to leave broader — this taxonomy only needs to be precise enough to group "same slot,
different equipment," not to win an anatomy exam.

**Tier** — a new `tier` column, `1 | 2 | 3`:
- `mechanic = 'isolation'` → always Tier 3. Deterministic, no exceptions — isolation is single-joint by
  definition, matching the "secondary assistance / stabilizer" tier described in published tier-system
  writeups.
- `mechanic = 'compound'` + `equipment IN ('barbell', 'body only')` → Tier 1 candidate (free-weight/
  bodyweight-loaded, highest stabilizer demand and joint complexity — the two cited CNS-fatigue drivers).
- `mechanic = 'compound'` + `equipment IN ('machine', 'cable', 'smith_machine')` → Tier 2 (fixed-path,
  materially lower stabilizer demand).
- `mechanic = 'compound'` + `equipment = 'dumbbell'` → genuinely ambiguous (a DB bench press reads Tier 1,
  a DB step-up reads Tier 2) — this is the one bucket that gets LLM-assisted classification, one exercise
  at a time, with a prompt grounded in the criteria above (joint count, load-bearing implement, whether the
  movement is typically programmed as a primary lift or an accessory). Given the equipment breakdown
  (124 dumbbell exercises total, a subset of which are compound), this is a small, cheap batch — not a
  from-scratch classification of all ~880 rows.
- `mechanic IS NULL` (87 rows) → fall back to Tier 2 as a safe default; these are largely
  cardio/stretching/plyometric rows unlikely to be selected as a split's primary lift anyway.

**Equipment-fallback grouping** — no new table. A fallback candidate set for exercise X is
`WHERE movement_pattern = X.movement_pattern AND primary_muscle = X.primary_muscle`, filtered to the
target equipment tier and ranked by tier proximity (same tier first, then adjacent). This directly
implements the "match pattern + muscle, not the specific exercise" principle from the equipment-
substitution research, and means adding a new exercise to the catalog later never requires manually
wiring its fallbacks.

**Process**: a one-time offline script (`server/database/classify-exercises.ts` or similar), not a live
endpoint. Deterministic rules run first and cover ~85%+ of rows; the LLM pass only touches the
compound+dumbbell residual; a spot-check step samples ~30 classified rows across tiers/patterns for a
human sanity pass before the results are written back. Existing `exercises` rows are updated in place
(`UPDATE ... SET tier = ?, movement_pattern = ?`), no data migration of dependent tables needed since
nothing references tier/pattern yet.

## 2. Weekly Volume Tracker (Phase 1 — independent, ships standalone)

No schema changes. New aggregation: for the current week, join `set_logs` → `exercise_logs` →
`exercise_muscles` (role = `primary`, matching the PRD's own coarse-grained example — "Chest: 16 sets,"
not "upper pecs: 9 sets") → `muscles`, grouped by muscle, counting distinct sets logged. Thresholds
straight from the volume-landmarks research: `< 10 sets/week` → Maintenance/Low Volume, `10–20` → Optimal
Hypertrophy Zone (this is literally the published MAV — Maximum Adaptive Volume — range for trained
lifters), `> 22` → High Overreach Risk. A new `SessionRepository.weeklySetsByMuscle(userId, weekStart,
weekEnd)` method plus a `GET` endpoint and a card on the Workouts page, styled like the PRD's progress-bar
mock (color banding: red/yellow/green matching the three bands above).

## 3. Recovery / Overuse Checker (Phase 2 — needs Phase 0's `tier`)

Non-blocking, advisory only (per the PRD's own framing — "non-blocking warning banner"). When a split has
two consecutive non-rest days both containing a Tier 1 exercise sharing a primary muscle, surface a
warning: *"[Muscle] is targeted with heavy compound work on back-to-back days — consider spacing these out
or inserting a lower-body/rest day."* This is a pure read: given a block's days (already fully loaded by
`BlockRepository.findWithDays`), walk consecutive day pairs and check for a Tier-1/shared-muscle overlap.
Runs client-side in the builder (Task in the custom/preset confirm step) using data already fetched — no
new endpoint needed.

## 4. Equipment profile (Phase 3 — needs Phase 0's `movement_pattern` + `primary_muscle`)

Today's `preset_splits.equipment` is `'gym' | 'home' | 'both'` (2.5 tiers) and per-exercise equipment is a
single free-text value with no substitution logic. This phase:
- Extends the *user-facing* equipment concept to the PRD's 4 tiers (`full_gym`, `home_barbell_dumbbell`,
  `home_dumbbell_only`, `bodyweight`) as a new field on the user profile (`shared/types/profile.types.ts`'s
  `Equipment` type currently only has `'gym' | 'home' | 'both'` — this widens it; existing rows migrate
  `gym → full_gym`, `home → home_barbell_dumbbell`, `both` stays a valid preset-matching value).
- Adds an exercise-substitution step to split *creation*: when a preset or custom day includes an exercise
  whose `equipment` doesn't fit the user's tier, the fallback query from §1 offers same-pattern/same-muscle
  alternatives that do fit, ranked same-tier-first. This is surfaced at the point the split is being built
  (preset picker and custom exercise picker), not as a runtime session-time swap — consistent with "modify
  my split" already being the app's model for changing what you're doing (per the split-builder design).

## 5. Exercise Swap Sheet (Phase 4 — needs Phase 0)

`GET /api/exercises/:id/alternatives` — same query as §1's fallback grouping, but user-facing and not
restricted to an equipment mismatch (any exercise can be swapped for taste, not just incompatibility). A
bottom sheet (matching the PRD's wireframe) opened from the custom split editor's exercise rows, listing
same-pattern/same-muscle/adjacent-tier alternatives with a thumbnail, reusing `ExerciseDetailDrawer`'s
existing preview pattern rather than building a new one.

## 6. Circuit/interval format (Phase 5 — needed for the Fat-Loss Circuit preset, §7)

Straight-set programming (`target_sets`/`target_reps`/`target_rpe`) can't express a metabolic-conditioning
circuit (back-to-back exercises, short prescribed rest, N rounds through the block) — confirmed against the
actual circuit-training research (40s work / 20s rest / 3-4 rounds is a representative structure). Schema
additions:
- `split_days` / `preset_split_days` gain `format TEXT NOT NULL DEFAULT 'straight_sets' CHECK (format IN
  ('straight_sets', 'circuit'))`.
- `split_exercises` / `preset_split_exercises` gain `rest_seconds INTEGER` (nullable — meaningful for
  circuit-format days, ignored for straight-set days where rest is left to the lifter).
- For a `circuit`-format day, `rounds INTEGER NOT NULL DEFAULT 1` lives on the day (a circuit repeats as a
  whole unit); each exercise's own `target_sets` is not used in circuit mode (one pass per round, driven by
  the day's `rounds`) — `target_reps` or a duration-based `set_type = 'time'` still describes the work
  itself.

**Explicit scope boundary**: this phase covers *prescribing* a circuit-format day in the builder. Actually
*running*/logging one live (a rounds-aware timer UI, rest countdowns between exercises) is real, separate
work on the session-logging page (`app/pages/workouts/session/[id].vue`) and is out of scope here — that
page's data model (`WorkoutSession`/`ExerciseLog`/`SetLog`) already supports logging individual sets against
a circuit's exercises even without a purpose-built timer UI; the UI enhancement is a later pass.

## 7. Preset catalog — 9 templates

The 6 PRD templates (validated against research, all confirmed standard):

| Template | Days | Format | Goal |
|---|---|---|---|
| Full Body A/B | 2 | straight_sets | general_fitness |
| PPL (3-day, 1x/muscle) | 3 | straight_sets | muscle_gain |
| Upper/Lower | 4 | straight_sets | muscle_gain |
| PPL (6-day, 2x/muscle) | 6 | straight_sets | muscle_gain |
| UL-PPL Hybrid | 5 | straight_sets | muscle_gain |
| Arnold Split | 6 | straight_sets | muscle_gain (advanced) |

Plus 3 additions from the follow-up research, explicitly approved:

| Template | Days | Format | Goal |
|---|---|---|---|
| Classic Bro Split | 5 | straight_sets | muscle_gain (advanced) — Chest / Back / Shoulders+Traps / Legs+Abs / Arms, the single most searched-for split name despite not being frequency-optimal per the research; included because users expect to find it by name. |
| Mobility | 2–3 | straight_sets | **mobility** (new Goal) — full-body, drawn from the 123 exercises already tagged `category = 'stretching'`. |
| Fat-Loss Circuit | 3 | **circuit** | fat_loss — full-body, drawn from the 61 `plyometrics` + 14 `cardio` category exercises, 3-4 rounds, short `rest_seconds`. |

`shared/types/profile.types.ts`'s `Goal` union gains `'mobility'`. This value needs threading through (all
already-existing call sites, confirmed via grep): `shared/schemas/onboarding.ts`'s zod enum,
`app/components/onboarding/ThirdStep.vue`'s goal-picker cards, `server/database/seed.ts`/`seed-dummy.ts`'s
achievement/preset seed data, and the existing `preset-split.service.test.ts`/`split.service.test.ts` test
fixtures that enumerate goals.

## 8. Wizard / profile wiring (Phase 6)

The 4-tier `Equipment` type change (§4) surfaces in: the onboarding equipment-selection step (currently
2.5-tier), the `/builder` preset picker's implicit equipment passthrough (today it reads
`profile.equipment` and sends it straight to `/api/preset-splits/recommend` — the recommend endpoint's own
scoring already treats equipment as an opaque enum match, so widening the enum is compatible, not a scoring
rewrite), and profile settings (if editable there).

## Explicitly out of scope

- Actually running/timing a circuit workout live (§6's boundary) — a session-logging UI enhancement, later.
- Sub-muscle-region granularity (upper vs. lower pecs, anterior/lateral/posterior delts) — the volume
  tracker and PRD's own UI mock both operate at the existing coarse muscle level; finer-grained tagging
  is a real but separate future data-quality project, not blocking anything designed here.
- A dedicated equipment-inventory system (e.g., "I have exactly a 5-50lb dumbbell set") — the 4-tier
  profile is a coarse capability flag, not a granular inventory, matching the PRD's own scope.
- Editing a split's exercises in place without replacing the whole block — still deferred, per the
  split-builder design's own explicit boundary; nothing here changes that.
