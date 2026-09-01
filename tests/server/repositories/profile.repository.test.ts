import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180 })
    const first = await repo.findByUserId('user-1')
    expect(first?.heightCm).toBe(180)

    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 182 })
    const second = await repo.findByUserId('user-1')
    expect(second?.heightCm).toBe(182)
  })

  it('has the four new profile columns in the schema', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180 })
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
      height: 180,
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
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180 })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.unitSystem).toBe('metric')
    expect(profile?.trainingDaysPerWeek).toBeNull()
    expect(profile?.equipment).toBeNull()
    expect(profile?.timezone).toBeNull()
  })

  it('preserves the existing unitSystem when a later upsert call omits it', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180, unitSystem: 'imperial' })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 181 })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.unitSystem).toBe('imperial')
  })

  it('resolves unitSystem before converting height, so a follow-up call that omits unitSystem still converts correctly', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 70, unitSystem: 'imperial' })
    const first = await repo.findByUserId('user-1')
    expect(first?.heightCm).toBeCloseTo(177.8, 1)

    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 71 })
    const second = await repo.findByUserId('user-1')
    expect(second?.heightCm).toBeCloseTo(180.3, 1)
    expect(second?.unitSystem).toBe('imperial')
  })

  it('preserves trainingDaysPerWeek, equipment, and timezone when a later upsert call omits them', async () => {
    await repo.upsert('user-1', {
      dateOfBirth: '1995-01-01', gender: 'male', height: 180,
      trainingDaysPerWeek: 4, equipment: 'gym', timezone: 'America/New_York',
    })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 181 })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.trainingDaysPerWeek).toBe(4)
    expect(profile?.equipment).toBe('gym')
    expect(profile?.timezone).toBe('America/New_York')
  })

  it('preserves activityLevel, experienceLevel, and primaryGoal when a later upsert call omits them', async () => {
    await repo.upsert('user-1', {
      dateOfBirth: '1995-01-01', gender: 'male', height: 180,
      activityLevel: 'moderately_active', experienceLevel: 'intermediate', primaryGoal: 'muscle_gain',
    })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 181 })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.activityLevel).toBe('moderately_active')
    expect(profile?.experienceLevel).toBe('intermediate')
    expect(profile?.primaryGoal).toBe('muscle_gain')
  })

  it('overwrites a previously-set field when a later upsert call provides a new value', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180, trainingDaysPerWeek: 4 })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180, trainingDaysPerWeek: 2 })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.trainingDaysPerWeek).toBe(2)
  })

  it('explicitly clears a field when a later upsert call passes null for it', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180, trainingDaysPerWeek: 4 })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180, trainingDaysPerWeek: null })

    const profile = await repo.findByUserId('user-1')
    expect(profile?.trainingDaysPerWeek).toBeNull()
  })

  describe('atomicity of the read-then-write (lost-update fix)', () => {
    function createFakeTxClient(existingRow: Record<string, unknown> | undefined) {
      const calls: string[] = []
      const txExecute = vi.fn(async (stmt: { sql: string }) => {
        calls.push(stmt.sql.trim().slice(0, 6).toUpperCase())
        if (stmt.sql.trim().toUpperCase().startsWith('SELECT')) {
          return { rows: existingRow ? [existingRow] : [] }
        }
        return { rows: [{ user_id: 'user-1', date_of_birth: '1995-01-01', gender: 'male', height_cm: 180, activity_level: null, experience_level: null, primary_goal: null, training_days_per_week: null, equipment: null, unit_system: 'metric', timezone: null, updated_at: 'now' }] }
      })
      const commit = vi.fn(async () => { calls.push('COMMIT') })
      const close = vi.fn(() => { calls.push('CLOSE') })
      const rollback = vi.fn(async () => { calls.push('ROLLBACK') })
      const tx = { execute: txExecute, commit, close, rollback, closed: false, batch: vi.fn(), executeMultiple: vi.fn() }
      const topLevelExecute = vi.fn(async () => { throw new Error('upsert must not use the top-level client.execute for its read/write') })
      const transaction = vi.fn(async () => tx)
      const fakeClient = { execute: topLevelExecute, transaction } as unknown as Client
      return { fakeClient, tx, transaction, topLevelExecute, calls }
    }

    it('performs the SELECT and the INSERT on the same transaction handle, then commits', async () => {
      const { fakeClient, transaction, topLevelExecute, calls } = createFakeTxClient(undefined)
      const fakeRepo = new ProfileRepository(fakeClient)

      await fakeRepo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180 })

      expect(transaction).toHaveBeenCalledExactlyOnceWith('write')
      expect(topLevelExecute).not.toHaveBeenCalled()
      expect(calls).toEqual(['SELECT', 'INSERT', 'COMMIT', 'CLOSE'])
    })

    it('closes the transaction without committing if the write fails', async () => {
      const { fakeClient, tx } = createFakeTxClient(undefined)
      tx.execute.mockImplementationOnce(async () => ({ rows: [] }))
      tx.execute.mockImplementationOnce(async () => { throw new Error('boom') })
      const fakeRepo = new ProfileRepository(fakeClient)

      await expect(fakeRepo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180 }))
        .rejects.toThrow('boom')

      expect(tx.commit).not.toHaveBeenCalled()
      expect(tx.close).toHaveBeenCalledOnce()
    })
  })
})
