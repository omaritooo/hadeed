-- Exercise catalog schema (seeded from free-exercise-db).
-- Normalized on muscles so muscle-targeting / split-generation queries
-- (e.g. "push exercises hitting chest or triceps, dumbbell only") are plain joins.
-- WARNING: never put a semicolon inside a comment. Loaders split this file on semicolons.

CREATE TABLE IF NOT EXISTS exercises (
  id            TEXT PRIMARY KEY,   -- stable slug, e.g. "3_4_Sit-Up"
  name          TEXT NOT NULL,
  category      TEXT,               -- strength, cardio, stretching, plyometrics, ...
  equipment     TEXT,               -- barbell, dumbbell, machine, cable, body only, ...
  force         TEXT,               -- push, pull, static
  level         TEXT,               -- beginner, intermediate, expert
  mechanic      TEXT,               -- compound, isolation
  instructions  TEXT                -- JSON array of strings
);

ALTER TABLE exercises ADD COLUMN movement_pattern TEXT;
ALTER TABLE exercises ADD COLUMN tier INTEGER CHECK (tier IN (1, 2, 3));

CREATE TABLE IF NOT EXISTS muscles (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS exercise_muscles (
  exercise_id  TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_id    INTEGER NOT NULL REFERENCES muscles(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
  PRIMARY KEY (exercise_id, muscle_id, role)
);

CREATE TABLE IF NOT EXISTS exercise_images (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id  TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  position     INTEGER NOT NULL
);

-- Alternate names people actually search for, mapped onto the catalog row that
-- already describes the movement. The source dataset names many common lifts in
-- ways nobody types ("Butterfly" for a pec deck, "Battling Ropes" for battle
-- ropes, "Standing Military Press" for an overhead press), and it has no plain
-- "Bench Press"/"Squat"/"Deadlift" row at all — only qualified variants. Aliases
-- fix search without duplicating the row (and so without needing a second set of
-- ROM images for the same movement).
CREATE TABLE IF NOT EXISTS exercise_aliases (
  alias        TEXT PRIMARY KEY COLLATE NOCASE,
  exercise_id  TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exercise_muscles_muscle   ON exercise_muscles(muscle_id);
CREATE INDEX IF NOT EXISTS idx_exercise_muscles_exercise ON exercise_muscles(exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercises_equipment       ON exercises(equipment);
CREATE INDEX IF NOT EXISTS idx_exercises_category        ON exercises(category);
CREATE INDEX IF NOT EXISTS idx_exercise_images_exercise  ON exercise_images(exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_aliases_exercise ON exercise_aliases(exercise_id);

-- Auth / RBAC. Turso has no row-level security, so user_id scoping and
-- permission checks are enforced in the service layer, not the database.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE users ADD COLUMN password_hash TEXT;

CREATE TABLE IF NOT EXISTS roles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  permissions  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Profile, body measurements, targets.

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth    TEXT NOT NULL,
  gender           TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  height_cm        REAL NOT NULL,
  activity_level   TEXT CHECK (activity_level IN
                     ('sedentary','lightly_active','moderately_active','very_active','extremely_active')),
  experience_level TEXT CHECK (experience_level IN ('beginner','intermediate','advanced')),
  primary_goal     TEXT CHECK (primary_goal IN ('fat_loss','muscle_gain','maintenance','general_fitness','mobility')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE user_profiles ADD COLUMN training_days_per_week INTEGER;
ALTER TABLE user_profiles ADD COLUMN equipment TEXT CHECK (equipment IN ('full_gym','home_barbell_dumbbell','home_dumbbell_only','bodyweight'));
ALTER TABLE user_profiles ADD COLUMN unit_system TEXT NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial'));
ALTER TABLE user_profiles ADD COLUMN timezone TEXT;
ALTER TABLE user_profiles ADD COLUMN hydration_target_ml INTEGER;
ALTER TABLE user_profiles ADD COLUMN hydration_reminders_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN hydration_reminder_interval_minutes INTEGER NOT NULL DEFAULT 120;
ALTER TABLE user_profiles ADD COLUMN hydration_last_reminded_at TEXT;

CREATE TABLE IF NOT EXISTS body_metrics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recorded_at    TEXT NOT NULL,
  weight_kg      REAL NOT NULL,
  body_fat_pct   REAL,
  visceral_fat   REAL,
  muscle_mass_kg REAL,
  source         TEXT NOT NULL CHECK (source IN ('manual','inbody','wearable'))
);

CREATE TABLE IF NOT EXISTS body_metric_measurements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  body_metric_id  INTEGER NOT NULL REFERENCES body_metrics(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  value_cm        REAL NOT NULL
);

-- Free-form log of water intake events -- each entry is one "add N ml" action, mirroring
-- body_metrics' one-row-per-recording shape rather than a single running daily counter, so
-- individual entries stay visible/undoable and "today's total" is just a SUM over the day.
CREATE TABLE IF NOT EXISTS hydration_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_ml   INTEGER NOT NULL,
  logged_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hydration_logs_user ON hydration_logs(user_id, logged_at);

-- One row per subscribed device/browser (a user can have several). endpoint is the push
-- service's unique URL for that subscription, so it doubles as the natural upsert key --
-- resubscribing the same device (e.g. after a permission reset) just updates its keys in place.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh_key  TEXT NOT NULL,
  auth_key    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS user_targets (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric                TEXT NOT NULL,
  target_value          REAL NOT NULL,
  target_date           TEXT,
  starting_value        REAL NOT NULL,
  starting_recorded_at  TEXT NOT NULL,
  achieved_at           TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1
);

-- Program -> Block -> SplitDay -> SplitExercise: the user's own, logged-against templates.

CREATE TABLE IF NOT EXISTS programs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id                INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  start_date                TEXT NOT NULL,
  end_date                  TEXT,
  training_day_macro_target TEXT,
  rest_day_macro_target     TEXT
);

-- Also has an is_rest_day column, added later via ALTER TABLE near the
-- workout session logging tables below.
CREATE TABLE IF NOT EXISTS split_days (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id     INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  day_of_week  INTEGER NOT NULL,
  location     TEXT NOT NULL CHECK (location IN ('gym','home'))
);

-- rounds is only meaningful when format = 'circuit' (a circuit repeats as a whole unit) -- straight_sets
-- days ignore it and keep the default.
ALTER TABLE split_days ADD COLUMN format TEXT NOT NULL DEFAULT 'straight_sets' CHECK (format IN ('straight_sets', 'circuit'));
ALTER TABLE split_days ADD COLUMN rounds INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS split_exercises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  split_day_id  INTEGER NOT NULL REFERENCES split_days(id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercises(id),
  position      INTEGER NOT NULL,
  set_type      TEXT NOT NULL CHECK (set_type IN ('weight_reps','bodyweight_reps','time')),
  target_sets   INTEGER,
  target_reps   INTEGER,
  target_rpe    REAL
);

ALTER TABLE split_exercises ADD COLUMN rest_seconds INTEGER;

-- Preset splits: admin-managed catalog, independent of any user's Block.

CREATE TABLE IF NOT EXISTS preset_splits (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  description         TEXT,
  frequency_min_days  INTEGER NOT NULL,
  frequency_max_days  INTEGER NOT NULL,
  goal                TEXT,
  experience_level    TEXT,
  equipment           TEXT NOT NULL CHECK (equipment IN ('full_gym','home_barbell_dumbbell','home_dumbbell_only','bodyweight','both')),
  is_published        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS preset_split_days (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_split_id  INTEGER NOT NULL REFERENCES preset_splits(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  day_index        INTEGER NOT NULL,
  location         TEXT NOT NULL CHECK (location IN ('gym','home'))
);

-- rounds is only meaningful when format = 'circuit' -- see the same note on split_days above.
ALTER TABLE preset_split_days ADD COLUMN format TEXT NOT NULL DEFAULT 'straight_sets' CHECK (format IN ('straight_sets', 'circuit'));
ALTER TABLE preset_split_days ADD COLUMN rounds INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS preset_split_day_muscles (
  preset_split_day_id  INTEGER NOT NULL REFERENCES preset_split_days(id) ON DELETE CASCADE,
  muscle_id            INTEGER NOT NULL REFERENCES muscles(id) ON DELETE CASCADE,
  PRIMARY KEY (preset_split_day_id, muscle_id)
);

CREATE TABLE IF NOT EXISTS preset_split_exercises (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_split_day_id  INTEGER NOT NULL REFERENCES preset_split_days(id) ON DELETE CASCADE,
  exercise_id          TEXT NOT NULL REFERENCES exercises(id),
  position             INTEGER NOT NULL,
  target_sets          INTEGER,
  target_reps          INTEGER,
  target_rpe           REAL
);

ALTER TABLE preset_split_exercises ADD COLUMN rest_seconds INTEGER;

-- Gamification.

CREATE TABLE IF NOT EXISTS xp_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS streaks (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak    INTEGER NOT NULL DEFAULT 0,
  longest_streak    INTEGER NOT NULL DEFAULT 0,
  last_active_date  TEXT
);

CREATE TABLE IF NOT EXISTS achievements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  key            TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  icon           TEXT,
  criteria_type  TEXT NOT NULL,
  criteria_value TEXT NOT NULL,
  is_published   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id  INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_user               ON blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_split_days_block           ON split_days(block_id);
CREATE INDEX IF NOT EXISTS idx_split_exercises_day        ON split_exercises(split_day_id);
CREATE INDEX IF NOT EXISTS idx_body_metrics_user          ON body_metrics(user_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_user_targets_user           ON user_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_preset_split_days_preset    ON preset_split_days(preset_split_id);
CREATE INDEX IF NOT EXISTS idx_preset_split_exercises_day  ON preset_split_exercises(preset_split_day_id);
CREATE INDEX IF NOT EXISTS idx_xp_ledger_user              ON xp_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user      ON user_achievements(user_id);

-- Workout session logging: what a user actually did, as opposed to what a
-- Block/SplitDay/SplitExercise prescribes. TEXT (caller-supplied UUID) ids on
-- these three tables, not INTEGER AUTOINCREMENT, because the client generates
-- them before an offline write ever reaches the server.

CREATE TABLE IF NOT EXISTS workout_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  split_day_id  INTEGER REFERENCES split_days(id) ON DELETE SET NULL,
  status        TEXT NOT NULL CHECK (status IN ('in_progress','completed','abandoned')) DEFAULT 'in_progress',
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

-- Snapshotted from split_days/preset_split_days.format/rounds at session-start time (same
-- reasoning as exercise_logs.rest_seconds below): a whole session is either a circuit or
-- straight sets, so this lives on the session, not per-exercise. A later edit to the split's
-- format doesn't retroactively change a past session's logging UI.
ALTER TABLE workout_sessions ADD COLUMN format TEXT NOT NULL DEFAULT 'straight_sets' CHECK (format IN ('straight_sets', 'circuit'));
ALTER TABLE workout_sessions ADD COLUMN rounds INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS exercise_logs (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id        TEXT NOT NULL REFERENCES exercises(id),
  split_exercise_id  INTEGER REFERENCES split_exercises(id),
  position           INTEGER NOT NULL,
  set_type           TEXT NOT NULL CHECK (set_type IN ('weight_reps','bodyweight_reps','time')),
  target_sets        INTEGER,
  target_reps        INTEGER,
  target_rpe         REAL
);

-- Snapshotted from split_exercises/preset_split_exercises.rest_seconds at session-start time,
-- so a later edit to the split's planned rest doesn't retroactively change a past session's log.
ALTER TABLE exercise_logs ADD COLUMN rest_seconds INTEGER;

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

-- Marks a set as a warm-up rather than a working set, so a light warm-up rep doesn't pollute
-- PR detection or exercise history/"last performed" (see SessionRepository) or weekly
-- volume-by-muscle tracking (see weeklySetsByMuscle) — those queries filter is_warmup = 0.
ALTER TABLE set_logs ADD COLUMN is_warmup INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_table   TEXT NOT NULL CHECK (entity_table IN ('set_logs','workout_sessions')),
  entity_id      TEXT NOT NULL,
  server_value   TEXT NOT NULL,
  proposed_value TEXT NOT NULL,
  base_version   INTEGER NOT NULL,
  detected_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT,
  resolution     TEXT CHECK (resolution IN ('kept_mine','kept_server','manual'))
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_user  ON workout_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_session  ON exercise_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_exercise ON exercise_logs(exercise_id);
CREATE INDEX IF NOT EXISTS idx_set_logs_exercise_log  ON set_logs(exercise_log_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_user    ON sync_conflicts(user_id, resolved_at);

-- Adds is_rest_day to split_days (declared above) so a Block's schedule can
-- mark a day as a rest day without string-matching on split_days.name.
ALTER TABLE split_days ADD COLUMN is_rest_day INTEGER NOT NULL DEFAULT 0;

-- Auth sessions: a random opaque token per login, stored server-side so it can be revoked by
-- deleting the row (unlike a self-contained signed cookie/JWT).
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Nutrition: personal ingredient catalog + logged meals + reusable preset meals.
-- Mirrors hydration_logs' "one row per event" shape, but a meal is a list of
-- ingredient lines rather than a single scalar, so it gets a two-table
-- log/log_items split like workout_sessions/exercise_logs.

-- user_id is nullable: a NULL row is a global preset food (seeded from
-- preset_foods.json, like the exercises catalog), visible to every user
-- alongside their own ingredients but only editable/deletable by its owner.
CREATE TABLE IF NOT EXISTS ingredients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  unit_type   TEXT NOT NULL CHECK (unit_type IN ('weight_100g', 'count')),
  unit_label  TEXT,               -- e.g. 'cup', 'can', 'scoop' (null when unit_type = 'weight_100g')
  calories    REAL NOT NULL,      -- per 100g if weight_100g, per 1 unit_label if count
  protein_g   REAL NOT NULL,
  carbs_g     REAL NOT NULL,
  fat_g       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS meal_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT,
  logged_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Nullable so pre-existing rows (logged before this column existed) stay uncategorized
-- rather than being forced into a guessed bucket. New logs are always given a value by
-- the service layer -- either the user's explicit pick or a time-of-day inference (see
-- shared/lib/meal-type.ts) -- so NULL should only ever be seen on historical rows.
ALTER TABLE meal_logs ADD COLUMN meal_type TEXT CHECK (meal_type IN ('breakfast','lunch','dinner','snack'));

-- ingredient_name/calories/protein_g/carbs_g/fat_g are a snapshot computed at
-- log time (quantity scaled against the ingredient's macros then), not a live
-- join -- editing an ingredient later must not rewrite past totals.
CREATE TABLE IF NOT EXISTS meal_log_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_log_id      INTEGER NOT NULL REFERENCES meal_logs(id) ON DELETE CASCADE,
  ingredient_id    INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  ingredient_name  TEXT NOT NULL,
  quantity         REAL NOT NULL,
  calories         REAL NOT NULL,
  protein_g        REAL NOT NULL,
  carbs_g          REAL NOT NULL,
  fat_g            REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS preset_meals (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preset_meal_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_meal_id  INTEGER NOT NULL REFERENCES preset_meals(id) ON DELETE CASCADE,
  ingredient_id   INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity        REAL NOT NULL
);

ALTER TABLE user_profiles ADD COLUMN nutrition_target_calories REAL;
ALTER TABLE user_profiles ADD COLUMN nutrition_target_protein_g REAL;
ALTER TABLE user_profiles ADD COLUMN nutrition_target_carbs_g REAL;
ALTER TABLE user_profiles ADD COLUMN nutrition_target_fat_g REAL;
ALTER TABLE user_profiles ADD COLUMN tdee_suggestion_dismissed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_ingredients_user       ON ingredients(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_logs_user          ON meal_logs(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_meal_log_items_meal     ON meal_log_items(meal_log_id);
CREATE INDEX IF NOT EXISTS idx_preset_meals_user       ON preset_meals(user_id);
CREATE INDEX IF NOT EXISTS idx_preset_meal_items_meal  ON preset_meal_items(preset_meal_id);

-- Joints an exercise commonly loads (see classifyStressors). 'rule' rows are rewritten on every
-- db:classify-exercises run, while 'manual' rows come from exercise_stressor_overrides.json and
-- survive reclassification. (No semicolons in comments: the schema is split on them.)
CREATE TABLE IF NOT EXISTS exercise_stressors (
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  area        TEXT NOT NULL CHECK (area IN ('knee','shoulder','lower_back','wrist','elbow','ankle')),
  source      TEXT NOT NULL CHECK (source IN ('rule','manual')),
  PRIMARY KEY (exercise_id, area)
);
CREATE INDEX IF NOT EXISTS idx_exercise_stressors_area ON exercise_stressors(area);

CREATE TABLE IF NOT EXISTS user_limitations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area    TEXT NOT NULL CHECK (area IN ('knee','shoulder','lower_back','wrist','elbow','ankle')),
  PRIMARY KEY (user_id, area)
);
