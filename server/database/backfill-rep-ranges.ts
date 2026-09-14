import { fileURLToPath } from 'node:url'
import { createClient, type Client } from '@libsql/client'
import { presetRepRangeMaxSql } from './preset-rep-range'

const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const
type RepRangeTable = typeof TABLES[number]

// Presets widen into a range, and user prescriptions and history keep min = max. Same rule as
// migrations/rep-ranges.ts.
const maxExpression = (table: RepRangeTable): string =>
  table === 'preset_split_exercises' ? presetRepRangeMaxSql('target_reps') : 'target_reps'

// Fills target_reps_min / target_reps_max on rows that only have target_reps: rows an older app
// build wrote after migrateRepRanges ran. A row with either end set, including an open-ended
// range like (8, NULL), was written by the range-aware app and is left alone. Safe to run any
// number of times. Run once the range-aware build is live, and again by the contract migration
// right before target_reps is dropped.
export const backfillRepRanges = async (db: Client): Promise<Record<RepRangeTable, number>> => {
  const results = await db.batch(TABLES.map(table => (
    `UPDATE ${table} SET target_reps_min = target_reps, target_reps_max = ${maxExpression(table)}
     WHERE target_reps_min IS NULL AND target_reps_max IS NULL AND target_reps IS NOT NULL`
  )), 'write')

  const updated = Object.fromEntries(TABLES.map((table, i) => [table, results[i]!.rowsAffected])) as Record<RepRangeTable, number>
  for (const table of TABLES) console.log(`Backfilled rep ranges on ${updated[table]} ${table} row(s).`)
  return updated
}

const main = async () => {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in the environment.')
    process.exit(1)
  }

  const db = createClient({ url, authToken })
  try {
    await backfillRepRanges(db)
  } finally {
    db.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
