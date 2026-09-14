import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { migrateRepRanges } from '~~/server/database/migrations/rep-ranges'

const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const
const USER_TABLES = ['split_exercises', 'exercise_logs'] as const

const createOldSchemaDb = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hadeed-rep-ranges-test-'))
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
  (await db.execute(`SELECT target_reps_min, target_reps_max FROM ${table} ORDER BY id`)).rows
    .map(row => [row.target_reps_min, row.target_reps_max])

describe('migrateRepRanges', () => {
  it('replaces target_reps with min and max columns on every table', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)

    for (const table of TABLES) {
      const columns = await columnsOf(db, table)
      expect(columns).toContain('target_reps_min')
      expect(columns).toContain('target_reps_max')
      expect(columns).not.toContain('target_reps')
    }
  })

  it('keeps user prescriptions and history as a zero-width range', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)

    for (const table of USER_TABLES) {
      expect(await rangesOf(db, table)).toEqual([[8, 8], [null, null], [12, 12], [20, 20]])
    }
  })

  it('widens preset prescriptions with the preset rep-range rule', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)

    expect(await rangesOf(db, 'preset_split_exercises')).toEqual([[8, 10], [null, null], [12, 15], [20, 25]])
  })

  it('is a no-op on an already-migrated database', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)
    await expect(migrateRepRanges(db)).resolves.toBeUndefined()
    expect(await columnsOf(db, 'exercise_logs')).not.toContain('target_reps')
    expect(await rangesOf(db, 'preset_split_exercises')).toEqual([[8, 10], [null, null], [12, 15], [20, 25]])
  })
})
