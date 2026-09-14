import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { migrateRepRanges } from '~~/server/database/migrations/rep-ranges'

const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const
const USER_TABLES = ['split_exercises', 'exercise_logs'] as const

const createOldSchemaDb = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hadeed-test-db-'))
  const db = createClient({ url: `file:${join(dir, 'test.db')}` })
  for (const table of TABLES) {
    await db.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, target_sets INTEGER, target_reps INTEGER, target_rpe REAL)`)
    await db.execute(`INSERT INTO ${table} (id, target_sets, target_reps, target_rpe) VALUES (1, 3, 8, 7), (2, 2, NULL, NULL), (3, 3, 12, 7), (4, 2, 20, NULL)`)
  }
  return db
}

const columnsOf = async (db: ReturnType<typeof createClient>, table: string) =>
  (await db.execute(`PRAGMA table_info(${table})`)).rows.map(row => row.name as string)

const rangesOf = async (db: ReturnType<typeof createClient>, table: string) =>
  (await db.execute(`SELECT target_reps, target_reps_min, target_reps_max FROM ${table} ORDER BY id`)).rows
    .map(row => [row.target_reps, row.target_reps_min, row.target_reps_max])

const USER_RANGES = [[8, 8, 8], [null, null, null], [12, 12, 12], [20, 20, 20]]
const PRESET_RANGES = [[8, 8, 10], [null, null, null], [12, 12, 15], [20, 20, 25]]

describe('migrateRepRanges', () => {
  it('adds min and max columns to every table and keeps target_reps', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)

    for (const table of TABLES) {
      const columns = await columnsOf(db, table)
      expect(columns).toContain('target_reps_min')
      expect(columns).toContain('target_reps_max')
      expect(columns).toContain('target_reps')
    }
  })

  it('copies user prescriptions and history into a zero-width range', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)

    for (const table of USER_TABLES) {
      expect(await rangesOf(db, table)).toEqual(USER_RANGES)
    }
  })

  it('widens preset prescriptions with the preset rep-range rule', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)

    expect(await rangesOf(db, 'preset_split_exercises')).toEqual(PRESET_RANGES)
  })

  it('is a no-op on an already-migrated database', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)
    // Rows written after the migration must not be overwritten by a re-run.
    await db.execute('UPDATE preset_split_exercises SET target_reps_max = 99 WHERE id = 1')

    await expect(migrateRepRanges(db)).resolves.toBeUndefined()
    expect((await db.execute('SELECT target_reps_max FROM preset_split_exercises WHERE id = 1')).rows[0]!.target_reps_max).toBe(99)
  })

  it('resumes a partial run, migrating the tables that were not yet migrated', async () => {
    const db = await createOldSchemaDb()
    await db.migrate([
      'ALTER TABLE split_exercises ADD COLUMN target_reps_min INTEGER',
      'ALTER TABLE split_exercises ADD COLUMN target_reps_max INTEGER',
      'UPDATE split_exercises SET target_reps_min = target_reps, target_reps_max = target_reps',
    ])

    await migrateRepRanges(db)

    expect(await rangesOf(db, 'split_exercises')).toEqual(USER_RANGES)
    expect(await rangesOf(db, 'preset_split_exercises')).toEqual(PRESET_RANGES)
    expect(await rangesOf(db, 'exercise_logs')).toEqual(USER_RANGES)
  })
})
