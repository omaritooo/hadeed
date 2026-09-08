import type { Client } from '@libsql/client'

// SQLite can't relax a CHECK constraint via ALTER TABLE, so a database created
// before user_profiles.equipment became a 4-tier column needs its `user_profiles`
// table rebuilt. No-ops once the CHECK already allows the new values. 'both' has
// no direct equivalent for a user profile, so it lands on the closest existing
// tier, 'home_barbell_dumbbell'.
export const migrateUserProfilesEquipmentTiers = async (db: Client): Promise<void> => {
  const info = await db.execute(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_profiles'`)
  const createSql = info.rows[0]?.sql as string | undefined
  if (!createSql || createSql.includes('full_gym')) return

  console.log('Migrating user_profiles.equipment to the 4-tier system...')
  // With foreign_keys enforcement on, DROP TABLE performs an implicit DELETE FROM
  // first, which fires any ON DELETE CASCADE rules of tables referencing this one.
  // A bare `PRAGMA foreign_keys = OFF` as its own db.execute() call does NOT
  // reliably protect against this: @libsql/client's HTTP transport opens and
  // closes a fresh Hrana stream (i.e. a potentially different underlying
  // connection) for every top-level execute() call, and sqld does not guarantee
  // that sequential requests share a session -- empirically verified against a
  // local sqld instance, where this exact sequence as separate execute() calls
  // let the DROP TABLE cascade and wipe the child rows anyway. db.migrate() is
  // the client's purpose-built API for this: it runs the whole statement list
  // through one logical connection, wrapped in a transaction, with
  // `PRAGMA foreign_keys=off`/`=on` applied outside that transaction (so the
  // pragma isn't a no-op the way it would be inside an explicit BEGIN) -- see
  // node_modules/@libsql/core/lib-esm/api.d.ts's `migrate` doc comment.
  await db.migrate([
    `
      CREATE TABLE user_profiles_new (
        user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        date_of_birth    TEXT NOT NULL,
        gender           TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
        height_cm        REAL NOT NULL,
        activity_level   TEXT CHECK (activity_level IN
                           ('sedentary','lightly_active','moderately_active','very_active','extremely_active')),
        experience_level TEXT CHECK (experience_level IN ('beginner','intermediate','advanced')),
        primary_goal     TEXT CHECK (primary_goal IN ('fat_loss','muscle_gain','maintenance','general_fitness')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
        training_days_per_week INTEGER,
        equipment        TEXT CHECK (equipment IN ('full_gym','home_barbell_dumbbell','home_dumbbell_only','bodyweight')),
        unit_system      TEXT NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial')),
        timezone         TEXT,
        hydration_target_ml INTEGER,
        hydration_reminders_enabled INTEGER NOT NULL DEFAULT 0,
        hydration_reminder_interval_minutes INTEGER NOT NULL DEFAULT 120,
        hydration_last_reminded_at TEXT,
        nutrition_target_calories REAL,
        nutrition_target_protein_g REAL,
        nutrition_target_carbs_g REAL,
        nutrition_target_fat_g REAL
      )
    `,
    `
      INSERT INTO user_profiles_new
      SELECT
        user_id, date_of_birth, gender, height_cm, activity_level, experience_level, primary_goal, updated_at,
        training_days_per_week,
        CASE equipment
          WHEN 'gym' THEN 'full_gym'
          WHEN 'home' THEN 'home_barbell_dumbbell'
          WHEN 'both' THEN 'home_barbell_dumbbell'
          ELSE equipment
        END,
        unit_system, timezone, hydration_target_ml, hydration_reminders_enabled,
        hydration_reminder_interval_minutes, hydration_last_reminded_at,
        nutrition_target_calories, nutrition_target_protein_g, nutrition_target_carbs_g, nutrition_target_fat_g
      FROM user_profiles
    `,
    'DROP TABLE user_profiles',
    'ALTER TABLE user_profiles_new RENAME TO user_profiles',
  ])
}

// Same rebuild as migrateUserProfilesEquipmentTiers, but for preset_splits, whose
// equipment column keeps 'both' as a valid value -- presets can genuinely be
// equipment-agnostic even though a user's own profile now picks one concrete tier.
export const migratePresetSplitsEquipmentTiers = async (db: Client): Promise<void> => {
  const info = await db.execute(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'preset_splits'`)
  const createSql = info.rows[0]?.sql as string | undefined
  if (!createSql || createSql.includes('full_gym')) return

  console.log('Migrating preset_splits.equipment to the 4-tier system...')
  // preset_split_days.preset_split_id has ON DELETE CASCADE onto this table, so
  // (as above) foreign_keys must be off for the rebuild or DROP TABLE's implicit
  // delete wipes every preset's days/muscles/exercises along with it -- via
  // db.migrate() rather than separate db.execute() calls; see the comment in
  // migrateUserProfilesEquipmentTiers for why a bare PRAGMA toggle across
  // sequential execute() calls doesn't reliably survive this client's HTTP
  // transport.
  await db.migrate([
    `
      CREATE TABLE preset_splits_new (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        name                TEXT NOT NULL,
        description         TEXT,
        frequency_min_days  INTEGER NOT NULL,
        frequency_max_days  INTEGER NOT NULL,
        goal                TEXT,
        experience_level    TEXT,
        equipment           TEXT NOT NULL CHECK (equipment IN ('full_gym','home_barbell_dumbbell','home_dumbbell_only','bodyweight','both')),
        is_published        INTEGER NOT NULL DEFAULT 0
      )
    `,
    `
      INSERT INTO preset_splits_new
      SELECT
        id, name, description, frequency_min_days, frequency_max_days, goal, experience_level,
        CASE equipment
          WHEN 'gym' THEN 'full_gym'
          WHEN 'home' THEN 'home_barbell_dumbbell'
          WHEN 'both' THEN 'both'
          ELSE equipment
        END,
        is_published
      FROM preset_splits
    `,
    'DROP TABLE preset_splits',
    'ALTER TABLE preset_splits_new RENAME TO preset_splits',
  ])
}
