import type { Client } from '@libsql/client'

// SQLite can't relax a CHECK constraint via ALTER TABLE, so a database seeded
// before 'mobility' became a valid primary_goal needs its `user_profiles`
// table rebuilt. No-ops once the CHECK already allows the new value. Unlike
// migrateUserProfilesEquipmentTiers, this is a pure widening -- every existing
// primary_goal value already satisfies the new, wider CHECK, so no CASE-based
// remapping is needed on the copy.
//
// See migrateUserProfilesEquipmentTiers (equipment-tiers.ts) for why this
// runs as a single db.migrate() call rather than separate db.execute() calls:
// @libsql/client's HTTP transport opens a fresh Hrana stream per top-level
// execute(), so a bare `PRAGMA foreign_keys = OFF` doesn't reliably survive
// across sequential calls against a real sqld/Turso endpoint, and the
// implicit DELETE FROM behind DROP TABLE would cascade through user_profiles'
// child rows if foreign_keys enforcement were still on. db.migrate() runs the
// whole statement list through one logical connection, wrapped in a
// transaction, with the pragma toggled outside it.
export const migrateUserProfilesGoalTiers = async (db: Client): Promise<void> => {
  const info = await db.execute(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_profiles'`)
  const createSql = info.rows[0]?.sql as string | undefined
  if (!createSql || createSql.includes('mobility')) return

  console.log('Migrating user_profiles.primary_goal to allow \'mobility\'...')
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
        primary_goal     TEXT CHECK (primary_goal IN ('fat_loss','muscle_gain','maintenance','general_fitness','mobility')),
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
        training_days_per_week, equipment, unit_system, timezone, hydration_target_ml, hydration_reminders_enabled,
        hydration_reminder_interval_minutes, hydration_last_reminded_at,
        nutrition_target_calories, nutrition_target_protein_g, nutrition_target_carbs_g, nutrition_target_fat_g
      FROM user_profiles
    `,
    'DROP TABLE user_profiles',
    'ALTER TABLE user_profiles_new RENAME TO user_profiles',
  ])
}
