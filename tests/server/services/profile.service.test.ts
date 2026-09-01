import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { TargetRepository } from '~~/server/repositories/target.repository'
import { ProfileService } from '~~/server/services/profile.service'
import type { RequestContext } from '~~/shared/types/rbac.types'
import { lbsToKg, round1 } from '~~/shared/lib/formulas'
import { verifyPassword } from '~~/server/utils/password'

describe('ProfileService', () => {
  let db: Client
  let service: ProfileService
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db), new TargetRepository(db))
  })

  it('completes onboarding by saving the profile and the first weight entry', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com',
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
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com',
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
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com',
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
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })

    const userRow = await db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: ['user-1'] })
    expect(userRow.rows[0]?.display_name).toBeNull()
  })

  it('writes an explicitly empty displayName instead of silently ignoring it', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75, displayName: '' })

    const userRow = await db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: ['user-1'] })
    expect(userRow.rows[0]?.display_name).toBe('')
  })

  it('includes displayName from users when reading the profile back', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', displayName: 'Jordan', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })

    const profile = await service.getProfile()
    expect(profile?.displayName).toBe('Jordan')
  })

  it('returns null displayName when none was ever set', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })

    const profile = await service.getProfile()
    expect(profile?.displayName).toBeNull()
  })

  it('converts weight using the profile\'s actual resolved unitSystem, not a stale pre-fetched guess', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 70, weight: 180, unitSystem: 'imperial' })

    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 71, weight: 184 })

    const metrics = await new BodyMetricsRepository(db).findForUser('user-1')
    expect(metrics[0]?.weightKg).toBeCloseTo(round1(lbsToKg(184)), 1)
  })

  it('creates an active weight target when targetWeight is provided', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 90, targetWeight: 80 })

    const profile = await service.getProfile()
    expect(profile?.targets).toHaveLength(1)
    expect(profile?.targets[0]).toMatchObject({ metric: 'weight', targetValue: 80, startingValue: 90, isActive: true })
  })

  it('converts targetWeight using the resolved unitSystem, same as weight', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 70, weight: 180, targetWeight: 160, unitSystem: 'imperial' })

    const profile = await service.getProfile()
    expect(profile?.targets[0]?.targetValue).toBeCloseTo(round1(lbsToKg(160)), 1)
  })

  it('does not create a target when targetWeight is omitted', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })

    const profile = await service.getProfile()
    expect(profile?.targets).toHaveLength(0)
  })

  it('does not create a duplicate active weight target on a repeat onboarding call', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 90, targetWeight: 80 })
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 88, targetWeight: 78 })

    const profile = await service.getProfile()
    expect(profile?.targets).toHaveLength(1)
  })

  it('creates the users row itself when the caller has no prior row (no signup flow exists yet)', async () => {
    const freshCtx: RequestContext = { userId: 'brand-new-user', roles: [], permissions: [] }
    const freshService = new ProfileService(freshCtx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db), new TargetRepository(db))

    await freshService.completeOnboarding({ password: 'Sup3rSecret!', email: 'brand-new@example.com', displayName: 'Brand New', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })

    const userRow = await db.execute({ sql: 'SELECT email, display_name FROM users WHERE id = ?', args: ['brand-new-user'] })
    expect(userRow.rows[0]?.email).toBe('brand-new@example.com')
    expect(userRow.rows[0]?.display_name).toBe('Brand New')
  })

  it('stores a verifiable password hash on first signup', async () => {
    await service.completeOnboarding({ password: 'Sup3rSecret!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })

    const userRow = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: ['user-1'] })
    const hash = userRow.rows[0]?.password_hash as string
    expect(hash).toBeTruthy()
    await expect(verifyPassword('Sup3rSecret!', hash)).resolves.toBe(true)
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false)
  })

  it('does not overwrite the password hash on a repeat onboarding call', async () => {
    await service.completeOnboarding({ password: 'FirstPassword!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 75 })
    await service.completeOnboarding({ password: 'SecondPassword!', email: 'a@example.com', dateOfBirth: '1995-06-15', gender: 'male', height: 178, weight: 76 })

    const userRow = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: ['user-1'] })
    await expect(verifyPassword('FirstPassword!', userRow.rows[0]?.password_hash as string)).resolves.toBe(true)
  })
})
