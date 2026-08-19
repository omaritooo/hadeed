import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { ProfileService } from '~~/server/services/profile.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

describe('ProfileService', () => {
  let db: Client
  let service: ProfileService
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db))
  })

  it('completes onboarding by saving the profile and the first weight entry', async () => {
    await service.completeOnboarding({
      dateOfBirth: '1995-06-15',
      gender: 'male',
      heightCm: 178,
      weightKg: 75,
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
      heightCm: 178,
      weightKg: 75,
      activityLevel: 'moderately_active',
    })

    const stats = await service.getComputedStats()
    expect(stats?.bmi).toBeGreaterThan(20)
    expect(stats?.tdee).toBeGreaterThan(1500)
  })

  it('returns null computed stats when there is no profile yet', async () => {
    expect(await service.getComputedStats()).toBeNull()
  })
})
