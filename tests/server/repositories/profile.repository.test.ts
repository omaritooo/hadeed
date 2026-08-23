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
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 181 }) // unitSystem omitted this time

    const profile = await repo.findByUserId('user-1')
    expect(profile?.unitSystem).toBe('imperial') // must NOT have been reset to 'metric'
  })

  it('resolves unitSystem before converting height, so a follow-up call that omits unitSystem still converts correctly', async () => {
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 70, unitSystem: 'imperial' })
    const first = await repo.findByUserId('user-1')
    expect(first?.heightCm).toBeCloseTo(177.8, 1)

    // Second call omits unitSystem entirely — must still be interpreted as imperial (preserved),
    // not misread as already-metric.
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 71 })
    const second = await repo.findByUserId('user-1')
    expect(second?.heightCm).toBeCloseTo(180.3, 1) // NOT 71
    expect(second?.unitSystem).toBe('imperial')
  })

  it('preserves trainingDaysPerWeek, equipment, and timezone when a later upsert call omits them', async () => {
    await repo.upsert('user-1', {
      dateOfBirth: '1995-01-01', gender: 'male', height: 180,
      trainingDaysPerWeek: 4, equipment: 'gym', timezone: 'America/New_York',
    })
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 181 }) // all three omitted

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
    await repo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 181 }) // all three omitted

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
    // Genuinely reproducing the race this fix closes -- two concurrent upsert() calls for the same
    // userId, interleaved so each reads the other's pre-commit snapshot -- turned out not to be
    // something the *local* sqlite3 test client can demonstrate reliably:
    //
    // 1. It was tried by holding a manual `db.transaction('write')` open and asserting that a
    //    concurrent `repo.upsert()` call gets rejected. That assertion held, but it turned out to
    //    hold identically against the *pre-fix* code too (the plain, un-transactioned `this.db.execute`
    //    calls): SQLite serializes ALL writes against a file while another write transaction is open,
    //    transactional or not, so that shape of test can't tell the fixed code apart from the buggy
    //    code -- it doesn't actually verify anything about this fix.
    // 2. It was tried by racing two real `repo.upsert()` calls via `Promise.all` and retrying on
    //    SQLITE_BUSY. The local driver (`libsql` 0.5.29, via `@libsql/client`'s sqlite3 client) does
    //    enforce real mutual exclusion between concurrent write transactions on the same file (a
    //    second `transaction('write')` call while one is open fails with SQLITE_BUSY), which is the
    //    right underlying guarantee -- but a connection that hits SQLITE_BUSY once was observed to get
    //    permanently wedged on every subsequent attempt (never recovering, even long after the
    //    contending transaction committed and closed), which made a retry-based test hang/fail
    //    unreliably. That's a local-driver quirk, not documented behavior of the remote Turso client
    //    this code actually runs against in production.
    //
    // So instead of a timing-based race test, these tests verify the actual mechanism directly: that
    // upsert() performs its read AND its write through the SAME transaction handle (not two
    // independent `this.db.execute` round trips), which is precisely what makes the read+write atomic
    // and closes the race. This is backed by reading `@libsql/client`'s `Client`/`Transaction` types
    // (`node_modules/@libsql/core/lib-esm/api.d.ts`) to confirm `transaction('write')`, `tx.execute`,
    // `tx.commit`, and `tx.close` are used exactly as documented.
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
      // Both statements ran on the transaction handle, in order, followed by a commit -- this is
      // what makes the read and the write atomic instead of two independent round trips.
      expect(calls).toEqual(['SELECT', 'INSERT', 'COMMIT', 'CLOSE'])
    })

    it('closes the transaction without committing if the write fails', async () => {
      const { fakeClient, tx } = createFakeTxClient(undefined)
      tx.execute.mockImplementationOnce(async () => ({ rows: [] })) // SELECT: no existing row
      tx.execute.mockImplementationOnce(async () => { throw new Error('boom') }) // INSERT fails
      const fakeRepo = new ProfileRepository(fakeClient)

      await expect(fakeRepo.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180 }))
        .rejects.toThrow('boom')

      expect(tx.commit).not.toHaveBeenCalled()
      expect(tx.close).toHaveBeenCalledOnce()
    })
  })
})
