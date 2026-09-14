import { describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { backfillRepRanges } from '~~/server/database/backfill-rep-ranges'

// Tables are created without foreign keys so the test can focus on the rep columns alone.
const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const

const createDb = async (): Promise<Client> => {
  const db = await createTestDb()
  for (const table of TABLES) {
    await db.execute(`DROP TABLE ${table}`)
    await db.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, target_reps INTEGER, target_reps_min INTEGER, target_reps_max INTEGER)`)
    await db.execute(`
      INSERT INTO ${table} (id, target_reps, target_reps_min, target_reps_max) VALUES
        (1, 8, NULL, NULL),
        (2, 12, NULL, NULL),
        (3, 20, NULL, NULL),
        (4, NULL, NULL, NULL),
        (5, 8, 8, NULL),
        (6, 6, 6, 9)
    `)
  }
  return db
}

const rangesOf = async (db: Client, table: string) =>
  (await db.execute(`SELECT target_reps_min, target_reps_max FROM ${table} ORDER BY id`)).rows
    .map(row => [row.target_reps_min, row.target_reps_max])

const UNTOUCHED = [[null, null], [8, null], [6, 9]]

describe('backfillRepRanges', () => {
  it('fills legacy rows as a zero-width range in user tables and leaves open or set ranges alone', async () => {
    const db = await createDb()
    await backfillRepRanges(db)

    for (const table of ['split_exercises', 'exercise_logs']) {
      expect(await rangesOf(db, table)).toEqual([[8, 8], [12, 12], [20, 20], ...UNTOUCHED])
    }
  })

  it('widens legacy preset rows with the preset rep-range rule', async () => {
    const db = await createDb()
    await backfillRepRanges(db)

    expect(await rangesOf(db, 'preset_split_exercises')).toEqual([[8, 10], [12, 15], [20, 25], ...UNTOUCHED])
  })

  it('reports rows updated per table and changes nothing on a second run', async () => {
    const db = await createDb()
    expect(await backfillRepRanges(db)).toEqual({ split_exercises: 3, preset_split_exercises: 3, exercise_logs: 3 })

    const before = await Promise.all(TABLES.map(table => rangesOf(db, table)))
    expect(await backfillRepRanges(db)).toEqual({ split_exercises: 0, preset_split_exercises: 0, exercise_logs: 0 })
    expect(await Promise.all(TABLES.map(table => rangesOf(db, table)))).toEqual(before)
  })
})
