import type { Client } from '@libsql/client'
import { presetRepRangeMaxSql } from '../preset-rep-range'

const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const

// split_exercises and exercise_logs hold a user's own prescriptions and their history, so their
// old target becomes a zero-width range (min = max) and keeps its meaning. Preset rows are
// catalog templates: the seed widens new presets with presetRepRange, but it skips presets that
// already exist, so existing rows are widened here with the same rule or they'd never get a range.
const maxExpression = (table: typeof TABLES[number]): string =>
  table === 'preset_split_exercises' ? presetRepRangeMaxSql('target_reps') : 'target_reps'

// Expand step of an expand/contract change from the single target_reps prescription to a min/max
// rep range. It only adds and fills target_reps_min and target_reps_max. target_reps stays, and
// the app dual-writes it (as the range minimum) and falls back to it on read, so an older app build
// running against a migrated database keeps working and a rollback needs no restore. A later
// release, once every client has updated, backfills any rows old code wrote, stops the dual-write
// and drops target_reps (plan Task 15).
//
// The guard is "has target_reps but not target_reps_min", so a re-run never overwrites ranges
// written since, and a run interrupted between tables picks up where it stopped. Each table's
// add/add/copy runs through one db.migrate() so it lands atomically -- see equipment-tiers.ts for
// why separate execute() calls aren't reliable over the HTTP transport.
export const migrateRepRanges = async (db: Client): Promise<void> => {
  for (const table of TABLES) {
    const info = await db.execute(`PRAGMA table_info(${table})`)
    const columns = info.rows.map(row => row.name as string)
    if (!columns.includes('target_reps') || columns.includes('target_reps_min')) continue

    console.log(`Adding a min/max rep range to ${table}...`)
    await db.migrate([
      `ALTER TABLE ${table} ADD COLUMN target_reps_min INTEGER`,
      `ALTER TABLE ${table} ADD COLUMN target_reps_max INTEGER`,
      `UPDATE ${table} SET target_reps_min = target_reps, target_reps_max = ${maxExpression(table)}`,
    ])
  }
}
