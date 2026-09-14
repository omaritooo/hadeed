import type { Client } from '@libsql/client'

const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const

// Replaces the single target_reps prescription with a min/max rep range so double progression
// has a "top of the range" to aim for. No table rebuild is needed: SQLite supports ADD COLUMN
// and DROP COLUMN for a column that isn't indexed or constrained. Existing rows keep their
// meaning by becoming a zero-width range (min = max = old target). Run through db.migrate()
// so each table's add/copy/drop lands atomically -- see equipment-tiers.ts for why separate
// execute() calls aren't reliable over the HTTP transport.
export const migrateRepRanges = async (db: Client): Promise<void> => {
  for (const table of TABLES) {
    const info = await db.execute(`PRAGMA table_info(${table})`)
    const columns = info.rows.map(row => row.name as string)
    if (!columns.includes('target_reps')) continue

    console.log(`Migrating ${table}.target_reps to a min/max range...`)
    await db.migrate([
      `ALTER TABLE ${table} ADD COLUMN target_reps_min INTEGER`,
      `ALTER TABLE ${table} ADD COLUMN target_reps_max INTEGER`,
      `UPDATE ${table} SET target_reps_min = target_reps, target_reps_max = target_reps`,
      `ALTER TABLE ${table} DROP COLUMN target_reps`,
    ])
  }
}
