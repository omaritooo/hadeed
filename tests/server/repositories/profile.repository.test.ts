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

  it('upserts and reads back trainingDaysPerWeek, equipment, unitSystem, and timezone', async () => {
    await repo.upsert('user-1', {
      dateOfBirth: '1995-01-01',
      gender: 'male',
      heightCm: 180,
      trainingDaysPerWeek: 4,
      equipment: 'gym',
      unitSystem: 'imperial',
      timezone: 'America/New_York',
    })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.trainingDaysPerWeek).toBe(4)
    expect(profile?.equipment).toBe('gym')
    expect(profile?.unitSystem).toBe('imperial')
    expect(profile?.timezone).toBe('America/New_York')
  })

  it('defaults unitSystem to metric and leaves the other three null when omitted', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180 })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.unitSystem).toBe('metric')
    expect(profile?.trainingDaysPerWeek).toBeNull()
    expect(profile?.equipment).toBeNull()
    expect(profile?.timezone).toBeNull()
  })

  it('preserves the existing unitSystem when a later upsert call omits it', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180, unitSystem: 'imperial' })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 181 }) // unitSystem omitted this time

    const profile = await repo.findByUserId('user-1')
    expect(profile?.unitSystem).toBe('imperial') // must NOT have been reset to 'metric'
  })

  it('preserves trainingDaysPerWeek, equipment, and timezone when a later upsert call omits them', async () => {
    await repo.upsert('user-1', {
      dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180,
      trainingDaysPerWeek: 4, equipment: 'gym', timezone: 'America/New_York',
    })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 181 }) // all three omitted

    const profile = await repo.findByUserId('user-1')
    expect(profile?.trainingDaysPerWeek).toBe(4)
    expect(profile?.equipment).toBe('gym')
    expect(profile?.timezone).toBe('America/New_York')
  })

  it('preserves activityLevel, experienceLevel, and primaryGoal when a later upsert call omits them', async () => {
    await repo.upsert('user-1', {
      dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180,
      activityLevel: 'moderately_active', experienceLevel: 'intermediate', primaryGoal: 'muscle_gain',
    })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 181 }) // all three omitted

    const profile = await repo.findByUserId('user-1')
    expect(profile?.activityLevel).toBe('moderately_active')
    expect(profile?.experienceLevel).toBe('intermediate')
    expect(profile?.primaryGoal).toBe('muscle_gain')
  })

  it('overwrites a previously-set field when a later upsert call provides a new value', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180, trainingDaysPerWeek: 4 })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180, trainingDaysPerWeek: 2 })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.trainingDaysPerWeek).toBe(2)
  })

  it('explicitly clears a field when a later upsert call passes null for it', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180, trainingDaysPerWeek: 4 })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', heightCm: 180, trainingDaysPerWeek: null })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.trainingDaysPerWeek).toBeNull()
  })
})
