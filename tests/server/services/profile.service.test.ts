import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { ProfileService } from '~~/server/services/profile.service'
import type { RequestContext } from '~~/shared/types/rbac.types'
import { lbsToKg, round1 } from '~~/shared/lib/formulas'

describe('ProfileService', () => {
  let db: Client
  let service: ProfileService
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db))
  })

  it('completes onboarding by saving the profile and the first weight entry', async () => {
    await service.completeOnboarding({
      dateOfBirth: '1995-06-15',
      gender: 'male',
      height: 178,
      weight: 75,
    })

    const profile = await service.getProfile()
    expect(profile?.heightCm).toBe(178)

    const metrics = await new BodyMetricsRepository(db).findForUser('user-1')
    expect(metrics).toHaveLength(1)
    expect(metrics[0]?.weightKg).toBe(75)
  })

  it('computes BMI and TDEE from the latest profile + weight once onboarding is done', async () => {
    await service.completeOnboarding({
      dateOfBirth: '1995-06-15',
      gender: 'male',
      height: 178,
      weight: 75,
      activityLevel: 'moderately_active',
    })

    const stats = await service.getComputedStats()
    expect(stats?.bmi).toBeGreaterThan(20)
    expect(stats?.tdee).toBeGreaterThan(1500)
  })

  it('returns null computed stats when there is no profile yet', async () => {
    expect(await service.getComputedStats()).toBeNull()
  })

  it('persists displayName, trainingDaysPerWeek, equipment, unitSystem, and timezone when provided', async () => {
    await service.completeOnboarding({
      displayName: 'Jordan',
      dateOfBirth: '1995-06-15',
      gender: 'other',
      height: 178,
      weight: 75,
      trainingDaysPerWeek: 4,
      equipment: 'home',
      unitSystem: 'imperial',
      timezone: 'America/New_York',
    })

    const profile = await service.getProfile()
    expect(profile?.gender).toBe('other')
    expect(profile?.trainingDaysPerWeek).toBe(4)
    expect(profile?.equipment).toBe('home')
    expect(profile?.unitSystem).toBe('imperial')
    expect(profile?.timezone).toBe('America/New_York')

    const userRow = await db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: ['user-1'] })
    expect(userRow.rows[0]?.display_name).toBe('Jordan')
  })

  it('does not touch display_name when displayName is omitted', async () => {
    await service.completeOnboarding({ dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })

    const userRow = await db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: ['user-1'] })
    expect(userRow.rows[0]?.display_name).toBeNull()
  })

  it('writes an explicitly empty displayName instead of silently ignoring it', async () => {
    await service.completeOnboarding({ dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75, displayName: '' })

    const userRow = await db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: ['user-1'] })
    expect(userRow.rows[0]?.display_name).toBe('')
  })

  it('includes displayName from users when reading the profile back', async () => {
    await service.completeOnboarding({ displayName: 'Jordan', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })

    const profile = await service.getProfile()
    expect(profile?.displayName).toBe('Jordan')
  })

  it('returns null displayName when none was ever set', async () => {
    await service.completeOnboarding({ dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })

    const profile = await service.getProfile()
    expect(profile?.displayName).toBeNull()
  })

  it('converts weight using the profile\'s actual resolved unitSystem, not a stale pre-fetched guess', async () => {
    await service.completeOnboarding({ dateOfBirth: '1995-06-15', gender: 'male', height: 70, weight: 180, unitSystem: 'imperial' })

    // Second call omits unitSystem — weight must still be interpreted as lbs (preserved imperial),
    // not misread as already-kg.
    await service.completeOnboarding({ dateOfBirth: '1995-06-15', gender: 'male', height: 71, weight: 184 })

    const metrics = await new BodyMetricsRepository(db).findForUser('user-1')
    expect(metrics[0]?.weightKg).toBeCloseTo(round1(lbsToKg(184)), 1) // NOT 184 raw
  })
})
