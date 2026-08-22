import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { ProfileRepository } from '~~/server/repositories/profile.repository'

describe('ProfileRepository', () => {
  let db: Client
  let repo: ProfileRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new ProfileRepository(db)
  })

  it('upserts a profile (insert then update, keyed on user_id)', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180 })
    const first = await repo.findByUserId('user-1')
    expect(first?.heightCm).toBe(180)

    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 182 })
    const second = await repo.findByUserId('user-1')
    expect(second?.heightCm).toBe(182)
  })

  it('has the four new profile columns in the schema', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180 })
    await db.execute({
      sql: `UPDATE user_profiles SET training_days_per_week = ?, equipment = ?, unit_system = ?, timezone = ?
            WHERE user_id = ?`,
      args: [4, 'gym', 'imperial', 'America/New_York', 'user-1'],
    })
    const result = await db.execute({ sql: 'SELECT * FROM user_profiles WHERE user_id = ?', args: ['user-1'] })
    const row = result.rows[0] as unknown as Record<string, unknown>
    expect(row.training_days_per_week).toBe(4)
    expect(row.equipment).toBe('gym')
    expect(row.unit_system).toBe('imperial')
    expect(row.timezone).toBe('America/New_York')
  })

  it('returns null for a user with no profile yet', async () => {
    expect(await repo.findByUserId('nobody')).toBeNull()
  })
})
