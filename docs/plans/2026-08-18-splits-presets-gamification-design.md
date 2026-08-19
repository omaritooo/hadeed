# Splits, Presets, Profile/Targets, and Gamification — Design

Date: 2026-08-18
Status: Approved, ready for implementation planning

## Context

The project is a Nuxt 4 PWA (`hadeed`) for workout/diet/hydration tracking, described
in `Gym App Plan from Claude.md`. That doc assumed Supabase (Postgres + RLS) as the
backend; the actual code uses Turso (libSQL/SQLite) via `@libsql/client`
(`server/utils/db.ts`), and `@nuxtjs/supabase` is a dependency but is **not** registered
as a Nuxt module — auth is not wired up yet. This design does not decide auth; every
service takes a `RequestContext { userId, roles }` regardless of where that ends up
coming from.

Because Turso has no row-level security, **the service layer is the actual security
boundary** in place of the RLS policies the original plan assumed. Every service method
touching user-scoped data must call `requireOwner(resourceUserId)` before returning or
mutating data, and this needs to be tested with two distinct fake user ids — same spirit
as "test RLS with two accounts," just enforced in code instead of Postgres.

Existing schema (`server/database/schema.sql`): `exercises`, `muscles`,
`exercise_muscles`, `exercise_images`, seeded from `gym_exercises.json` (873 exercises,
via `server/database/seed.ts`). `server/services/base.service.ts` exists but is empty.

This design covers:
1. Repository/service architecture with types shared between server and client
2. User profile, body measurements, and targets
3. Program → Block → SplitDay → SplitExercise (built together, not staged)
4. Preset splits (admin-managed catalog, separate from user Blocks) + a recommendation
   engine
5. Guided split creation (from-scratch vs. from-preset)
6. Gamification (XP, streaks, achievements, PR celebration) — schema + service
   interfaces only; triggering on logged sessions is deferred until `WorkoutSession`/
   `Set` exist (step 3 of the original build order), not built ahead of it.

## 1. Data model

Conventions follow the existing `schema.sql`: `INTEGER PRIMARY KEY AUTOINCREMENT` for
internal ids, `TEXT PRIMARY KEY` only where an id is externally meaningful (as
`exercises.id` already is, a stable slug). All new user-scoped tables carry a `user_id`
column, which is the enforcement point in the absence of RLS.

### Auth / RBAC

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,       -- from whatever auth ends up providing
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE roles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,    -- 'admin', 'member', ...
  name         TEXT NOT NULL,
  permissions  TEXT NOT NULL            -- JSON array of permission strings
);

CREATE TABLE user_roles (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
```

Permissions are plain strings (e.g. `"preset:write"`, `"achievement:write"`) checked by
`BaseService.requirePermission`. Data-driven (a role's permission list is a DB row, not
a hardcoded enum), extensible without more roles/permissions tables than this.

### Profile, measurements, targets

```sql
CREATE TABLE user_profiles (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth    TEXT NOT NULL,
  gender           TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  height_cm        REAL NOT NULL,
  activity_level   TEXT CHECK (activity_level IN
                     ('sedentary','lightly_active','moderately_active','very_active','extremely_active')),
  experience_level TEXT CHECK (experience_level IN ('beginner','intermediate','advanced')),
  primary_goal     TEXT CHECK (primary_goal IN ('fat_loss','muscle_gain','maintenance','general_fitness')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE body_metrics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recorded_at    TEXT NOT NULL,          -- date
  weight_kg      REAL NOT NULL,
  body_fat_pct   REAL,
  visceral_fat   REAL,
  muscle_mass_kg REAL,
  source         TEXT NOT NULL CHECK (source IN ('manual','inbody','wearable'))
);

CREATE TABLE body_metric_measurements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  body_metric_id  INTEGER NOT NULL REFERENCES body_metrics(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,         -- 'waist', 'chest', 'arm_left', ...
  value_cm        REAL NOT NULL
);

CREATE TABLE user_targets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric             TEXT NOT NULL,      -- 'weight' | 'body_fat_pct' | 'measurement:<key>'
  target_value       REAL NOT NULL,
  target_date        TEXT,
  starting_value     REAL NOT NULL,
  starting_recorded_at TEXT NOT NULL,
  achieved_at        TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1
);
```

Onboarding requires `date_of_birth`, `gender`, `height_cm`, plus a first `body_metrics`
row for weight; everything else is optional and fillable later. BMI and TDEE
(Mifflin-St Jeor) are **computed shared pure functions** (`shared/lib/formulas.ts`),
not stored columns, so client and server never disagree and no extra fetch is needed to
render them. `activity_level` is presented in the UI as job/lifestyle phrasing ("mostly
sitting" / "on my feet all day" / "physically demanding job") rather than raw fitness
tiers.

Deliberately **not** included: age-based training-frequency rules. There's no solid
basis for e.g. "over 40 → lower frequency," so age/activity feed TDEE and macro
suggestions (a well-defined use) rather than invented split-recommendation rules. They
remain available on the profile if a real rule is wanted later.

Targets feed a macro-suggestion path: when a Block's training/rest macro targets are
set, the service can propose starting numbers from TDEE adjusted by the direction of any
active weight target (cut/bulk/maintain) — a suggestion, not an enforced value.

### Program → Block → SplitDay → SplitExercise

```sql
CREATE TABLE programs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL
);

CREATE TABLE blocks (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id                INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  start_date                TEXT NOT NULL,
  end_date                  TEXT,
  training_day_macro_target TEXT,   -- JSON {calories, protein_g, carbs_g, fat_g}
  rest_day_macro_target     TEXT
);

CREATE TABLE split_days (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id   INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,          -- 'Push', 'Pull', 'Legs', 'Rest', ...
  day_of_week INTEGER NOT NULL,      -- 0-6
  location   TEXT NOT NULL CHECK (location IN ('gym','home'))
);

CREATE TABLE split_exercises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  split_day_id  INTEGER NOT NULL REFERENCES split_days(id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercises(id),
  position      INTEGER NOT NULL,
  set_type      TEXT NOT NULL CHECK (set_type IN ('weight_reps','bodyweight_reps','time')),
  target_sets   INTEGER,
  target_reps   INTEGER,
  target_rpe    REAL
);
```

### Preset splits (separate from Block, per decision)

```sql
CREATE TABLE preset_splits (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  description        TEXT,
  frequency_min_days INTEGER NOT NULL,
  frequency_max_days INTEGER NOT NULL,
  goal               TEXT,           -- same domain as user_profiles.primary_goal
  experience_level   TEXT,
  equipment          TEXT NOT NULL CHECK (equipment IN ('gym','home','both')),
  is_published       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE preset_split_days (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_split_id  INTEGER NOT NULL REFERENCES preset_splits(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  day_index        INTEGER NOT NULL,
  location         TEXT NOT NULL CHECK (location IN ('gym','home'))
);

CREATE TABLE preset_split_day_muscles (
  preset_split_day_id  INTEGER NOT NULL REFERENCES preset_split_days(id) ON DELETE CASCADE,
  muscle_id            INTEGER NOT NULL REFERENCES muscles(id) ON DELETE CASCADE,
  PRIMARY KEY (preset_split_day_id, muscle_id)
);

CREATE TABLE preset_split_exercises (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_split_day_id  INTEGER NOT NULL REFERENCES preset_split_days(id) ON DELETE CASCADE,
  exercise_id          TEXT NOT NULL REFERENCES exercises(id),
  position             INTEGER NOT NULL,
  target_sets          INTEGER,
  target_reps          INTEGER,
  target_rpe           REAL
);
```

`preset_splits.*` writes require the `preset:write` permission (admin role). Reads are
open to any authenticated user (browsing/recommendation).

### Gamification

```sql
CREATE TABLE xp_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  source_type TEXT NOT NULL,          -- 'set_logged', 'session_completed', 'pr', ...
  source_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, source_type, source_id)
);

CREATE TABLE streaks (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak  INTEGER NOT NULL DEFAULT 0,
  longest_streak  INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT
);

CREATE TABLE achievements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  key            TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  icon           TEXT,
  criteria_type  TEXT NOT NULL,       -- 'session_count', 'streak_length', 'pr', 'target_hit', ...
  criteria_value TEXT NOT NULL,       -- JSON, shape depends on criteria_type
  is_published   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE user_achievements (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, achievement_id)
);
```

The ledger's `UNIQUE(user_id, source_type, source_id)` constraint makes XP awards
idempotent — a retried request can't double-count. XP level is derived from total XP via
a shared pure function, not a stored column. `achievements.*` writes also require
`achievement:write` (admin role); a small starter catalog ships as seed data: first
session logged, 7-day streak, 30-day streak, first PR, first target hit, first block
completed.

## 2. Shared types + repository/service architecture

```
shared/
  types/
    exercise.types.ts      Exercise, Muscle, MuscleRole, ExerciseMuscle
    profile.types.ts       UserProfile, BodyMetric, BodyMetricMeasurement, UserTarget
    split.types.ts         Program, Block, SplitDay, SplitExercise, SetType, DayLocation
    preset.types.ts        PresetSplit, PresetSplitDay, PresetSplitExercise, Goal,
                            ExperienceLevel, Equipment
    gamification.types.ts  XpEvent, Streak, Achievement, UserAchievement
    rbac.types.ts          Role, Permission
  lib/
    formulas.ts             bmi(), tdee(), xpToLevel() — pure, unit-tested, no DB import

server/
  repositories/
    base.repository.ts      generic findById/findMany/insert/update/delete over the
                             libSQL client; subclasses supply tableName + mapRow
    exercise.repository.ts, muscle.repository.ts
    profile.repository.ts, body-metrics.repository.ts, target.repository.ts
    program.repository.ts, block.repository.ts (nested SplitDay/SplitExercise writes
      in one transaction)
    preset-split.repository.ts (nested days/muscles/exercises)
    role.repository.ts
    xp.repository.ts, streak.repository.ts, achievement.repository.ts
  services/
    base.service.ts         RequestContext { userId, roles }, requireOwner(resourceUserId),
                             requirePermission(permission) — the actual security boundary
                             in the absence of RLS
    exercise.service.ts, muscle.service.ts
    profile.service.ts (incl. BMI/TDEE lookups), body-metrics.service.ts, target.service.ts
    split.service.ts        create-from-scratch, create-from-preset (clone), update, delete
    preset-split.service.ts admin CRUD + browse + recommend()
    gamification.service.ts awardXp, updateStreak, evaluateAchievements
    role.service.ts
```

`shared/` holds only plain types and pure functions — nothing importing `@libsql/client`
or anything server-only — so Nuxt 4's shared-directory auto-import makes the same types
available on both sides without a build step or manual sync.

## 3. Recommendation engine

Weighted scoring, not a static lookup table, over every `preset_split`:

- `+3` if `daysPerWeek` is within `[frequency_min_days, frequency_max_days]`, partial
  credit (`+1`) if within one day of the range
- `+2` for `experience_level` match
- `+2` for `goal` match
- `+2` for `equipment` match (or the preset is tagged `'both'`)

Sort descending, return the top N with a short "why recommended" string assembled from
which factors matched (e.g. "fits your 4 days/week, matches your hypertrophy goal") —
this is user-facing copy, not just an internal score.

## 4. Guided split creation

One `Block`-creation flow, two entry points:

- **From scratch** — empty `SplitDay`s, exercises added manually.
- **From a preset** — user picks a `preset_split`; each day shows its target muscles
  (`preset_split_day_muscles`) and recommended exercises (`preset_split_exercises`)
  pre-filled. Any exercise can be kept, removed, or swapped; swapping opens the exercise
  picker pre-filtered to that day's target muscles via `exercise_muscles`, but isn't
  hard-locked to them.

Either path **materializes a real, independent `Block`/`SplitDay`/`SplitExercise`** for
that user on save — no foreign key back to the preset, matching the "clone, don't
reference" rule the original plan already set for shareable templates between users.

## 5. Gamification

`gamification.service.ts` exposes `awardXp`, `updateStreak`, `evaluateAchievements`, but
these are **hooks designed now, wired later** — they trigger on `WorkoutSession`/`Set`
being logged, which don't exist yet (step 3 of the original build order). This round
ships the schema, the service interfaces, and the achievement-evaluation shape; nothing
fires until session logging exists.

- **Streak**: plan-aware — a week counts if the user logged a session on every non-Rest
  `split_day` scheduled by their active Block; missing one resets `current_streak` to 0.
- **XP**: per logged set, bonus for completing a full scheduled session, bonus for a new
  PR — via the idempotent ledger in section 1.
- **Achievements**: evaluated by `criteria_type`/`criteria_value`, not hardcoded
  if-chains, so the admin-managed catalog can grow without a code change.
- **PR celebration**: detected at set-logging time (estimated 1RM via the Epley formula
  already in the original plan, or a new volume PR) and surfaced immediately rather than
  only appearing later on the progress dashboard.

## Open items deferred on purpose

- Auth mechanism (how `RequestContext.userId` actually gets populated) — out of scope
  here; every service is written against the `RequestContext` shape regardless.
- Gamification triggers firing on real data — depends on `WorkoutSession`/`Set`, which
  come later in the existing build order.
- Admin UI for managing presets/achievements — this design assumes it exists per your
  answer (admin-managed in-app), but its screens aren't detailed here; the service-level
  permission checks (`preset:write`, `achievement:write`) are what implementation needs.
