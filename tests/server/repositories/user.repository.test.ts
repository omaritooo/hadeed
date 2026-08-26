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

describe('UserRepository.findDisplayName', () => {
  let db: Client
  let repo: UserRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new UserRepository(db)
  })

  it('round-trips a display name set via updateDisplayName', async () => {
    await repo.updateDisplayName('user-1', 'Jordan')

    expect(await repo.findDisplayName('user-1')).toBe('Jordan')
  })

  it('returns null for a user who exists but never had a display name set', async () => {
    expect(await repo.findDisplayName('user-1')).toBeNull()
  })
})

describe('UserRepository.ensureExists / findByEmail', () => {
  let db: Client
  let repo: UserRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new UserRepository(db)
  })

  it('ensureExists creates the row with a password hash when it does not exist yet', async () => {
    await repo.ensureExists('user-2', 'b@example.com', 'salthex:hashhex', 'Bailey')

    const found = await repo.findByEmail('b@example.com')
    expect(found?.id).toBe('user-2')
    expect(found?.passwordHash).toBe('salthex:hashhex')
  })

  it('ensureExists does not overwrite an existing row (including its password)', async () => {
    await repo.ensureExists('user-1', 'a@example.com', 'original-hash')
    await repo.ensureExists('user-1', 'a@example.com', 'different-hash', 'New Name')

    const found = await repo.findByEmail('a@example.com')
    expect(found?.passwordHash).toBe('original-hash')
  })

  it('findByEmail returns null for an email with no account', async () => {
    expect(await repo.findByEmail('nobody@example.com')).toBeNull()
  })
})

describe('UserRepository schema', () => {
  let db: Client

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  })

  it('has the password_hash column and a sessions table in the schema', async () => {
    await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: ['abc:def', 'user-1'] })
    const userRow = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: ['user-1'] })
    expect(userRow.rows[0]?.password_hash).toBe('abc:def')

    await db.execute({ sql: "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", args: ['sess-1', 'user-1'] })
    const sessionRow = await db.execute({ sql: 'SELECT user_id FROM sessions WHERE id = ?', args: ['sess-1'] })
    expect(sessionRow.rows[0]?.user_id).toBe('user-1')
  })
})
