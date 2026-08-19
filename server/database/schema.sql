-- Exercise catalog schema (seeded from free-exercise-db).
-- Normalized on muscles so muscle-targeting / split-generation queries
-- (e.g. "push exercises hitting chest or triceps, dumbbell only") are plain joins.

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

CREATE INDEX IF NOT EXISTS idx_exercise_muscles_muscle   ON exercise_muscles(muscle_id);
CREATE INDEX IF NOT EXISTS idx_exercise_muscles_exercise ON exercise_muscles(exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercises_equipment       ON exercises(equipment);
CREATE INDEX IF NOT EXISTS idx_exercises_category        ON exercises(category);
CREATE INDEX IF NOT EXISTS idx_exercise_images_exercise  ON exercise_images(exercise_id);

-- Auth / RBAC. Turso has no row-level security, so user_id scoping and
-- permission checks are enforced in the service layer, not the database.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  primary_goal     TEXT CHECK (primary_goal IN ('fat_loss','muscle_gain','maintenance','general_fitness')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS split_days (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id     INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  day_of_week  INTEGER NOT NULL,
  location     TEXT NOT NULL CHECK (location IN ('gym','home'))
);

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

-- Preset splits: admin-managed catalog, independent of any user's Block.

CREATE TABLE IF NOT EXISTS preset_splits (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  description         TEXT,
  frequency_min_days  INTEGER NOT NULL,
  frequency_max_days  INTEGER NOT NULL,
  goal                TEXT,
  experience_level    TEXT,
  equipment           TEXT NOT NULL CHECK (equipment IN ('gym','home','both')),
  is_published        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS preset_split_days (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_split_id  INTEGER NOT NULL REFERENCES preset_splits(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  day_index        INTEGER NOT NULL,
  location         TEXT NOT NULL CHECK (location IN ('gym','home'))
);

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
