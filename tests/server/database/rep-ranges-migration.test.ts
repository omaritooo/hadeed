import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { migrateRepRanges } from '~~/server/database/migrations/rep-ranges'

const TABLES = ['split_exercises', 'preset_split_exercises', 'exercise_logs'] as const

const createOldSchemaDb = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hadeed-rep-ranges-test-'))
  const db = createClient({ url: `file:${join(dir, 'test.db')}` })
  for (const table of TABLES) {
    await db.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, target_sets INTEGER, target_reps INTEGER, target_rpe REAL)`)
    await db.execute(`INSERT INTO ${table} (id, target_sets, target_reps, target_rpe) VALUES (1, 3, 8, 7), (2, 2, NULL, NULL)`)
  }
  return db
}

const columnsOf = async (db: ReturnType<typeof createClient>, table: string) =>
  (await db.execute(`PRAGMA table_info(${table})`)).rows.map(row => row.name as string)

describe('migrateRepRanges', () => {
  it('copies target_reps into min and max, then drops target_reps', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)

    for (const table of TABLES) {
      const columns = await columnsOf(db, table)
      expect(columns).toContain('target_reps_min')
      expect(columns).toContain('target_reps_max')
      expect(columns).not.toContain('target_reps')

      const rows = (await db.execute(`SELECT id, target_reps_min, target_reps_max FROM ${table} ORDER BY id`)).rows
      expect(rows[0]).toMatchObject({ target_reps_min: 8, target_reps_max: 8 })
      expect(rows[1]).toMatchObject({ target_reps_min: null, target_reps_max: null })
    }
  })

  it('is a no-op on an already-migrated database', async () => {
    const db = await createOldSchemaDb()
    await migrateRepRanges(db)
    await expect(migrateRepRanges(db)).resolves.toBeUndefined()
    expect(await columnsOf(db, 'exercise_logs')).not.toContain('target_reps')
  })
})
