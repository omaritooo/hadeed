import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { migratePresetSplitsEquipmentTiers, migrateUserProfilesEquipmentTiers } from '~~/server/database/migrations/equipment-tiers'

// These migrations exist because a live database seeded before the equipment
// column widened to the 4/5-tier system still has the OLD 3-value CHECK
// constraint, which SQLite can't relax via ALTER TABLE -- the table has to be
// rebuilt (CREATE ..._new, copy rows across with a remapped equipment value,
// DROP the old table, RENAME the new one in). preset_splits has cascade-
// configured children (preset_split_days -> preset_split_day_muscles /
// preset_split_exercises), and a first attempt at this rebuild used a bare
// `PRAGMA foreign_keys = OFF` as its own db.execute() call, which let the
// DROP TABLE's implicit delete cascade through those children and wipe them
// on the live database. The fix (verified separately against a real sqld/
// Turso HTTP endpoint, not reproducible with this file-based local client --
// see note at the bottom of this file) is to run the whole rebuild through
// `db.migrate()` instead of separate `db.execute()` calls.
//
// This suite builds each table in its OLD (pre-migration) shape by hand,
// seeds cascade-child rows, runs the real migration function, and asserts
// the children survive and the equipment values were remapped correctly.

const createOldSchemaDb = async (): Promise<Client> => {
  const dir = mkdtempSync(join(tmpdir(), 'hadeed-equipment-migration-test-'))
  const db = createClient({ url: `file:${join(dir, 'test.db')}` })

  await db.execute('CREATE TABLE users (id TEXT PRIMARY KEY)')
  await db.execute('CREATE TABLE muscles (id INTEGER PRIMARY KEY, name TEXT)')
  await db.execute('CREATE TABLE exercises (id TEXT PRIMARY KEY, name TEXT)')

  // Old, pre-migration user_profiles shape: 3-value equipment CHECK, and only
  // the columns the migration's rebuild actually needs to carry across.
  await db.execute(`
    CREATE TABLE user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      date_of_birth TEXT NOT NULL,
      gender TEXT NOT NULL,
      height_cm REAL NOT NULL,
      activity_level TEXT,
      experience_level TEXT,
      primary_goal TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      training_days_per_week INTEGER,
      equipment TEXT CHECK (equipment IN ('gym','home','both')),
      unit_system TEXT NOT NULL DEFAULT 'metric',
      timezone TEXT,
      hydration_target_ml INTEGER,
      hydration_reminders_enabled INTEGER NOT NULL DEFAULT 0,
      hydration_reminder_interval_minutes INTEGER NOT NULL DEFAULT 120,
      hydration_last_reminded_at TEXT,
      nutrition_target_calories REAL,
      nutrition_target_protein_g REAL,
      nutrition_target_carbs_g REAL,
      nutrition_target_fat_g REAL
    )
  `)

  // Old, pre-migration preset_splits shape, plus its real cascade children.
  await db.execute(`
    CREATE TABLE preset_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      frequency_min_days INTEGER NOT NULL,
      frequency_max_days INTEGER NOT NULL,
      goal TEXT,
      experience_level TEXT,
      equipment TEXT NOT NULL CHECK (equipment IN ('gym','home','both')),
      is_published INTEGER NOT NULL DEFAULT 0
    )
  `)
  await db.execute(`
    CREATE TABLE preset_split_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preset_split_id INTEGER NOT NULL REFERENCES preset_splits(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      day_index INTEGER NOT NULL,
      location TEXT NOT NULL CHECK (location IN ('gym','home'))
    )
  `)
  await db.execute(`
    CREATE TABLE preset_split_day_muscles (
      preset_split_day_id INTEGER NOT NULL REFERENCES preset_split_days(id) ON DELETE CASCADE,
      muscle_id INTEGER NOT NULL REFERENCES muscles(id) ON DELETE CASCADE,
      PRIMARY KEY (preset_split_day_id, muscle_id)
    )
  `)
  await db.execute(`
    CREATE TABLE preset_split_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preset_split_day_id INTEGER NOT NULL REFERENCES preset_split_days(id) ON DELETE CASCADE,
      exercise_id TEXT NOT NULL REFERENCES exercises(id),
      position INTEGER NOT NULL,
      target_sets INTEGER,
      target_reps_min INTEGER,
      target_reps_max INTEGER,
      target_rpe REAL
    )
  `)

  return db
}

describe('equipment tier migrations', () => {
  it('rebuilds user_profiles onto the 4-tier CHECK and remaps old equipment values', async () => {
    const db = await createOldSchemaDb()
    await db.execute(`INSERT INTO users (id) VALUES ('u1'), ('u2'), ('u3')`)
    await db.execute(`
      INSERT INTO user_profiles (user_id, date_of_birth, gender, height_cm, equipment)
      VALUES ('u1', '1990-01-01', 'male', 180, 'gym'),
             ('u2', '1991-01-01', 'female', 165, 'home'),
             ('u3', '1992-01-01', 'other', 175, 'both')
    `)

    await migrateUserProfilesEquipmentTiers(db)

    const result = await db.execute('SELECT user_id, equipment FROM user_profiles ORDER BY user_id')
    expect(result.rows).toEqual([
      { user_id: 'u1', equipment: 'full_gym' },
      { user_id: 'u2', equipment: 'home_barbell_dumbbell' },
      { user_id: 'u3', equipment: 'home_barbell_dumbbell' },
    ])

    // The new CHECK constraint should now reject an old-tier value.
    await expect(
      db.execute(`UPDATE user_profiles SET equipment = 'gym' WHERE user_id = 'u1'`),
    ).rejects.toThrow()
  })

  it('is a no-op when run again against an already-migrated user_profiles table', async () => {
    const db = await createOldSchemaDb()
    await db.execute(`INSERT INTO users (id) VALUES ('u1')`)
    await db.execute(`
      INSERT INTO user_profiles (user_id, date_of_birth, gender, height_cm, equipment)
      VALUES ('u1', '1990-01-01', 'male', 180, 'gym')
    `)

    await migrateUserProfilesEquipmentTiers(db)
    await expect(migrateUserProfilesEquipmentTiers(db)).resolves.toBeUndefined()

    const result = await db.execute('SELECT equipment FROM user_profiles WHERE user_id = ?', ['u1'])
    expect(result.rows[0]!.equipment).toBe('full_gym')
  })

  it('rebuilds preset_splits onto the 5-tier CHECK without losing cascade-configured child rows', async () => {
    const db = await createOldSchemaDb()
    await db.execute(`INSERT INTO muscles (id, name) VALUES (1, 'chest'), (2, 'back')`)
    await db.execute(`INSERT INTO exercises (id, name) VALUES ('bench', 'Bench Press'), ('row', 'Row')`)
    await db.execute(`
      INSERT INTO preset_splits (id, name, frequency_min_days, frequency_max_days, equipment, is_published)
      VALUES (1, 'PPL', 3, 6, 'gym', 1), (2, 'Home Split', 2, 3, 'both', 1)
    `)
    await db.execute(`
      INSERT INTO preset_split_days (id, preset_split_id, name, day_index, location)
      VALUES (10, 1, 'Push', 0, 'gym'), (11, 1, 'Pull', 1, 'gym'), (12, 2, 'Full Body', 0, 'home')
    `)
    await db.execute(`
      INSERT INTO preset_split_day_muscles (preset_split_day_id, muscle_id)
      VALUES (10, 1), (11, 2), (12, 1), (12, 2)
    `)
    await db.execute(`
      INSERT INTO preset_split_exercises (preset_split_day_id, exercise_id, position, target_sets, target_reps_min, target_reps_max, target_rpe)
      VALUES (10, 'bench', 0, 4, 8, 8, 8), (11, 'row', 0, 3, 10, 10, 7), (12, 'bench', 0, 3, 12, 12, 7)
    `)

    // Sanity check on the fixture itself before migrating.
    expect((await db.execute('SELECT COUNT(*) as n FROM preset_split_days')).rows[0]!.n).toBe(3)
    expect((await db.execute('SELECT COUNT(*) as n FROM preset_split_day_muscles')).rows[0]!.n).toBe(4)
    expect((await db.execute('SELECT COUNT(*) as n FROM preset_split_exercises')).rows[0]!.n).toBe(3)

    await migratePresetSplitsEquipmentTiers(db)

    // The real bug: a bare PRAGMA-off db.execute() call let DROP TABLE's implicit
    // delete cascade through these children. They must all still be here.
    expect((await db.execute('SELECT COUNT(*) as n FROM preset_split_days')).rows[0]!.n).toBe(3)
    expect((await db.execute('SELECT COUNT(*) as n FROM preset_split_day_muscles')).rows[0]!.n).toBe(4)
    expect((await db.execute('SELECT COUNT(*) as n FROM preset_split_exercises')).rows[0]!.n).toBe(3)

    const equipment = await db.execute('SELECT id, equipment FROM preset_splits ORDER BY id')
    expect(equipment.rows).toEqual([
      { id: 1, equipment: 'full_gym' },
      { id: 2, equipment: 'both' }, // preset_splits keeps 'both' as a valid tier, unlike user_profiles
    ])
  })

  it('is a no-op when run again against an already-migrated preset_splits table', async () => {
    const db = await createOldSchemaDb()
    await db.execute(`
      INSERT INTO preset_splits (id, name, frequency_min_days, frequency_max_days, equipment, is_published)
      VALUES (1, 'PPL', 3, 6, 'gym', 1)
    `)

    await migratePresetSplitsEquipmentTiers(db)
    await expect(migratePresetSplitsEquipmentTiers(db)).resolves.toBeUndefined()

    const result = await db.execute('SELECT equipment FROM preset_splits WHERE id = 1')
    expect(result.rows[0]!.equipment).toBe('full_gym')
  })

  it.todo('this suite cannot catch a regression back to sequential db.execute() calls -- it needs a real HTTP-backed sqld/Turso endpoint to reproduce the connection-splitting failure mode; re-verify manually against one if these functions change how they talk to the database (see the file-bottom note)')
})

// NOTE on coverage: @libsql/client's local `file:` client (used above, and by
// this repo's other repository/service tests via createTestDb()) always talks
// to a single, persistent, same-process SQLite connection. That means it
// cannot reproduce the failure mode this suite is actually guarding against:
// against the REMOTE HTTP client this project uses in production (Turso),
// separate top-level `db.execute()` calls each open and close their own Hrana
// stream, and sqld does not guarantee those share a session/connection -- a
// bare `PRAGMA foreign_keys = OFF` followed by later separate `execute()`
// calls silently failed to prevent the cascade when this was verified against
// a real local sqld instance. This suite will pass even if a future change
// reverts migrateUserProfilesEquipmentTiers/migratePresetSplitsEquipmentTiers
// from `db.migrate()` back to sequential `db.execute()` calls, because the
// local test client tolerates that pattern just fine. Anyone changing how
// these two functions talk to the database should re-verify against a real
// HTTP-backed sqld/Turso endpoint, not just this suite.
