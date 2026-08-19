import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { XpRepository } from '~~/server/repositories/xp.repository'

describe('XpRepository', () => {
  let db: Client
  let repo: XpRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new XpRepository(db)
  })

  it('sums awarded xp for a user', async () => {
    await repo.award('user-1', 10, 'set_logged', 'set-1')
    await repo.award('user-1', 10, 'set_logged', 'set-2')
    expect(await repo.totalForUser('user-1')).toBe(20)
  })

  it('is idempotent: awarding the same source twice only counts once', async () => {
    await repo.award('user-1', 10, 'set_logged', 'set-1')
    await repo.award('user-1', 10, 'set_logged', 'set-1')
    expect(await repo.totalForUser('user-1')).toBe(10)
  })
})
