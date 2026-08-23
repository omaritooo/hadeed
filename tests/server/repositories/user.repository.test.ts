import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { UserRepository } from '~~/server/repositories/user.repository'

describe('UserRepository.updateDisplayName', () => {
  let db: Client
  let repo: UserRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new UserRepository(db)
  })

  it('sets the display name for an existing user', async () => {
    await repo.updateDisplayName('user-1', 'Jordan')

    const result = await db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: ['user-1'] })
    expect(result.rows[0]?.display_name).toBe('Jordan')
  })

  it('is a no-op for a user id that does not exist, rather than throwing', async () => {
    await expect(repo.updateDisplayName('nonexistent', 'Nobody')).resolves.not.toThrow()
  })
})
