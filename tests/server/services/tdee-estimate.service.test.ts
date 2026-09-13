import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { TdeeEstimateService } from '~~/server/services/tdee-estimate.service'

const NOW = new Date('2026-09-14T12:00:00Z')

describe('TdeeEstimateService', () => {
  let db: Client
  let profiles: ProfileRepository
  let service: TdeeEstimateService
  let formulaTdee: number | null

  const logMeal = async (calories: number, loggedAt: string) => {
    const log = await new MealLogRepository(db).log('user-1', null, [{ ingredientId: 1, ingredientName: 'Food', quantity: 1, calories, proteinG: 0, carbsG: 0, fatG: 0 }], 'lunch')
    await db.execute({ sql: 'UPDATE meal_logs SET logged_at = ? WHERE id = ?', args: [loggedAt, log.id] })
  }

  const seedData = async (calories: number) => {
    const metrics = new BodyMetricsRepository(db)
    for (let i = 0; i < 28; i++) {
      const date = new Date(NOW)
      date.setUTCDate(date.getUTCDate() - i)
      const iso = date.toISOString().slice(0, 10)
      await logMeal(calories, `${iso} 12:00:00`)
      if (i % 2 === 0) await metrics.record('user-1', { recordedAt: `${iso}T07:00:00.000Z`, weightKg: 80, source: 'manual', measurements: [] })
    }
  }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO ingredients (id, user_id, name, unit_type, calories, protein_g, carbs_g, fat_g) VALUES (1, NULL, 'Food', 'count', 1, 0, 0, 0)`)
    profiles = new ProfileRepository(db)
    await profiles.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180, activityLevel: 'moderately_active', primaryGoal: 'maintenance' })
    formulaTdee = 2400
    service = new TdeeEstimateService(
      { userId: 'user-1', roles: [], permissions: [] },
      profiles, new BodyMetricsRepository(db), new MealLogRepository(db),
      { getComputedStats: async () => ({ bmi: 24, tdee: formulaTdee, latestWeightKg: 80 }) },
    )
  })

  it('suggests a target when the estimate differs from the current target by 150+ kcal', async () => {
    await seedData(2800)
    await profiles.setNutritionTarget('user-1', { calories: 2400, proteinG: 180, carbsG: 240, fatG: 80 })

    const result = await service.getEstimate(NOW)

    expect(result).toMatchObject({ status: 'ready', estimate: 2800, shouldSuggest: true })
    expect(result.suggestedTarget?.calories).toBe(2800)
  })

  it('does not suggest when the difference is small', async () => {
    await seedData(2450)
    await profiles.setNutritionTarget('user-1', { calories: 2400, proteinG: 180, carbsG: 240, fatG: 80 })
    expect((await service.getEstimate(NOW)).shouldSuggest).toBe(false)
  })

  it('does not suggest for 14 days after a dismissal', async () => {
    await seedData(2800)
    await service.dismiss(new Date('2026-09-10T12:00:00Z'))
    expect((await service.getEstimate(NOW)).shouldSuggest).toBe(false)
    expect((await service.getEstimate(new Date('2026-09-25T12:00:00Z'))).shouldSuggest).toBe(true)
  })

  it('never suggests without a primary goal', async () => {
    await seedData(2800)
    await db.execute(`UPDATE user_profiles SET primary_goal = NULL WHERE user_id = 'user-1'`)
    expect(await service.getEstimate(NOW)).toMatchObject({ status: 'ready', shouldSuggest: false, suggestedTarget: null })
  })

  it('returns insufficient with no data', async () => {
    expect(await service.getEstimate(NOW)).toMatchObject({ status: 'insufficient', shouldSuggest: false, suggestedTarget: null })
  })

  it('ignores a partially logged today', async () => {
    await seedData(2800)
    await logMeal(1500, '2026-09-14 12:00:00')

    expect(await service.getEstimate(NOW)).toMatchObject({ status: 'ready', estimate: 2800, avgIntake: 2800 })
  })
})
