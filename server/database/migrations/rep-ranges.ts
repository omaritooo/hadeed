import type { Client } from '@libsql/client'
import { PRESET_REP_RANGE_SQL } from '../preset-rep-range'

const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const

// split_exercises and exercise_logs hold a user's own prescriptions and their history, so their
// old target becomes a zero-width range (min = max) and keeps its meaning. Preset rows are
// catalog templates: the seed widens new presets with presetRepRange, but it skips presets that
// already exist, so existing rows are widened here with the same rule or they'd never get a range.
const maxExpression = (table: typeof TABLES[number]): string =>
  table === 'preset_split_exercises' ? PRESET_REP_RANGE_SQL('target_reps') : 'target_reps'

// Replaces the single target_reps prescription with a min/max rep range so double progression
// has a "top of the range" to aim for. No table rebuild is needed: SQLite supports ADD COLUMN
// and DROP COLUMN for a column that isn't indexed or constrained. Run through db.migrate()
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
      `UPDATE ${table} SET target_reps_min = target_reps, target_reps_max = ${maxExpression(table)}`,
      `ALTER TABLE ${table} DROP COLUMN target_reps`,
    ])
  }
}
