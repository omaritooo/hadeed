import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { MealLogRepository, type MealLogItemInput } from '~~/server/repositories/meal-log.repository'
import { toSqliteDatetime } from '~~/server/utils/date'

describe('MealLogRepository', () => {
  let db: Client
  let repo: MealLogRepository

  const chickenItem: MealLogItemInput = {
    ingredientId: 1,
    ingredientName: 'Chicken breast',
    quantity: 150,
    calories: 247.5,
    proteinG: 46.5,
    carbsG: 0,
    fatG: 5.4,
  }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({
      sql: `INSERT INTO ingredients (id, user_id, name, unit_type, calories, protein_g, carbs_g, fat_g)
            VALUES (1, 'user-1', 'Chicken breast', 'weight_100g', 165, 31, 0, 3.6)`,
    })
    repo = new MealLogRepository(db)
  })

  it('logs a meal with its items and reads it back', async () => {
    const log = await repo.log('user-1', 'Lunch', [chickenItem])
    expect(log.name).toBe('Lunch')
    expect(log.items).toHaveLength(1)
    expect(log.items[0]).toMatchObject(chickenItem)
  })

  it('finds meals logged within a date range', async () => {
    await db.execute({
      sql: 'INSERT INTO meal_logs (user_id, name, logged_at) VALUES (?, ?, ?)',
      args: ['user-1', 'Yesterday', toSqliteDatetime(new Date('2026-08-01T12:00:00Z'))],
    })
    await repo.log('user-1', 'Today', [chickenItem])

    const results = await repo.findForRange(
      'user-1',
      toSqliteDatetime(new Date('2026-08-02T00:00:00Z')),
      toSqliteDatetime(new Date('2026-08-03T00:00:00Z')),
    )
    expect(results).toHaveLength(0)
  })

  it('deletes only the caller\'s own meal log', async () => {
    const log = await repo.log('user-1', 'Lunch', [chickenItem])
    await repo.delete(log.id, 'user-2')
    expect(await repo.findForRange('user-1', '2020-01-01 00:00:00', '2999-01-01 00:00:00')).toHaveLength(1)

    await repo.delete(log.id, 'user-1')
    expect(await repo.findForRange('user-1', '2020-01-01 00:00:00', '2999-01-01 00:00:00')).toHaveLength(0)
  })
})
