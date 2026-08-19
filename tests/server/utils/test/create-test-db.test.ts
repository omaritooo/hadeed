import { describe, expect, it } from 'vitest'
import { createTestDb } from '~~/server/utils/test/create-test-db'

describe('createTestDb', () => {
  it('applies the schema so known tables exist', async () => {
    const db = await createTestDb()
    const result = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='exercises'`,
    )
    expect(result.rows.length).toBe(1)
  })
})
