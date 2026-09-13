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
    expect(log.mealType).toBeNull()
    expect(log.items).toHaveLength(1)
    expect(log.items[0]).toMatchObject(chickenItem)
  })

  it('persists an explicit meal type', async () => {
    const log = await repo.log('user-1', 'Lunch', [chickenItem], 'lunch')
    expect(log.mealType).toBe('lunch')
  })

  it('finds meals logged within a date range', async () => {
    const insertAt = async (name: string, loggedAt: string) => {
      await db.execute({
        sql: 'INSERT INTO meal_logs (user_id, name, logged_at) VALUES (?, ?, ?)',
        args: ['user-1', name, loggedAt],
      })
    }

    // Range under test: [2026-08-02 00:00:00, 2026-08-03 00:00:00)
    await insertAt('Before', '2026-08-01 23:59:59') // just before the start boundary -> excluded
    await insertAt('AtStart', '2026-08-02 00:00:00') // exactly on the inclusive start boundary -> included
    await insertAt('Inside', '2026-08-02 12:00:00') // strictly inside -> included
    await insertAt('AtEnd', '2026-08-03 00:00:00') // exactly on the exclusive end boundary -> excluded

    const results = await repo.findForRange(
      'user-1',
      toSqliteDatetime(new Date('2026-08-02T00:00:00Z')),
      toSqliteDatetime(new Date('2026-08-03T00:00:00Z')),
    )
    expect(results.map(r => r.name)).toEqual(['AtStart', 'Inside'])
  })

  it('sums calories per calendar day in range, omitting days with no meals', async () => {
    const item = (calories: number): MealLogItemInput => ({ ...chickenItem, calories })
    const logAt = async (items: MealLogItemInput[], loggedAt: string, userId = 'user-1') => {
      const log = await repo.log(userId, null, items)
      await db.execute({ sql: 'UPDATE meal_logs SET logged_at = ? WHERE id = ?', args: [loggedAt, log.id] })
    }
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })

    await logAt([item(300)], '2026-08-01 08:00:00')
    await logAt([item(500), item(200)], '2026-08-01 13:00:00')
    await logAt([item(900)], '2026-08-03 19:00:00')
    await logAt([item(700)], '2026-07-31 23:59:59') // before the inclusive start -> excluded
    await logAt([item(600)], '2026-08-29 00:00:00') // on the exclusive end -> excluded
    await logAt([item(400)], '2026-08-01 12:00:00', 'user-2') // another user's meal -> excluded

    expect(await repo.dailyCaloriesInRange('user-1', '2026-08-01', '2026-08-29')).toEqual([
      { date: '2026-08-01', calories: 1000 },
      { date: '2026-08-03', calories: 900 },
    ])
  })

  it('deletes only the caller\'s own meal log', async () => {
    const log = await repo.log('user-1', 'Lunch', [chickenItem])
    await repo.delete(log.id, 'user-2')
    expect(await repo.findForRange('user-1', '2020-01-01 00:00:00', '2999-01-01 00:00:00')).toHaveLength(1)

    await repo.delete(log.id, 'user-1')
    expect(await repo.findForRange('user-1', '2020-01-01 00:00:00', '2999-01-01 00:00:00')).toHaveLength(0)
  })
})
