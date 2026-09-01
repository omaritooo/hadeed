import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { AuthSessionRepository } from '~~/server/repositories/auth-session.repository'

describe('AuthSessionRepository', () => {
  let db: Client
  let repo: AuthSessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new AuthSessionRepository(db)
  })

  it('creates a session with a random id and resolves it back via findValid', async () => {
    const session = await repo.create('user-1')
    expect(session.id).toHaveLength(43)
    expect(session.userId).toBe('user-1')

    const found = await repo.findValid(session.id)
    expect(found?.userId).toBe('user-1')
  })

  it('generates a different id on every call', async () => {
    const a = await repo.create('user-1')
    const b = await repo.create('user-1')
    expect(a.id).not.toBe(b.id)
  })

  it('returns null for an id that does not exist', async () => {
    expect(await repo.findValid('nonexistent')).toBeNull()
  })

  it('returns null for an expired session', async () => {
    const session = await repo.create('user-1')
    await db.execute({ sql: "UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE id = ?", args: [session.id] })

    expect(await repo.findValid(session.id)).toBeNull()
  })

  it('deletes a session so it no longer resolves', async () => {
    const session = await repo.create('user-1')
    await repo.delete(session.id)

    expect(await repo.findValid(session.id)).toBeNull()
  })

  it('deleting a nonexistent session id is a no-op, not an error', async () => {
    await expect(repo.delete('nonexistent')).resolves.not.toThrow()
  })
})
