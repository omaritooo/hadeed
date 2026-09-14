import { describe, expect, it } from 'vitest'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { UserLimitationRepository } from '~~/server/repositories/user-limitation.repository'

describe('UserLimitationRepository', () => {
  it('replaces the whole set and reads it back in canonical order', async () => {
    const db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const repo = new UserLimitationRepository(db)

    await repo.replace('user-1', ['wrist', 'knee'])
    expect(await repo.findForUser('user-1')).toEqual(['knee', 'wrist'])

    await repo.replace('user-1', ['shoulder'])
    expect(await repo.findForUser('user-1')).toEqual(['shoulder'])

    await repo.replace('user-1', [])
    expect(await repo.findForUser('user-1')).toEqual([])
  })
})
