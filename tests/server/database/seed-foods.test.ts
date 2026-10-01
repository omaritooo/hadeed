import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { upsertPresetFoods, type RawPresetFood } from '~~/server/database/seed-foods'

const food = (overrides: Partial<RawPresetFood> = {}): RawPresetFood => ({
  name: 'Koshari',
  nameAr: 'كشري',
  category: 'grains',
  keywords: 'koshary, kushari',
  unitType: 'weight_100g',
  unitLabel: null,
  calories: 153,
  proteinG: 4.7,
  carbsG: 23,
  fatG: 4.8,
  ...overrides,
})

const presets = async (db: Client) =>
  (await db.execute('SELECT id, name, name_ar, category, keywords, calories FROM ingredients WHERE user_id IS NULL ORDER BY id')).rows

describe('upsertPresetFoods', () => {
  let db: Client

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute(`INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')`)
  })

  it('stores the Arabic name, category and search keywords', async () => {
    await upsertPresetFoods(db, [food()])

    expect(await presets(db)).toMatchObject([{ name: 'Koshari', name_ar: 'كشري', category: 'grains', keywords: 'koshary, kushari' }])
  })

  it('updates an existing preset in place on a re-seed', async () => {
    await upsertPresetFoods(db, [food()])
    const [before] = await presets(db)

    await upsertPresetFoods(db, [food({ calories: 160 })])

    expect(await presets(db)).toMatchObject([{ id: before!.id, calories: 160 }])
  })

  // Renaming a preset must not orphan it: meal_log_items and preset_meal_items point at the row id,
  // so a rename that inserted a fresh row would leave every logged meal pointing at the old one.
  it('renames a preset found under a previous name, keeping its id', async () => {
    await upsertPresetFoods(db, [food({ name: 'Mullet (بوري, cooked)', nameAr: null })])
    const [before] = await presets(db)

    await upsertPresetFoods(db, [food({ name: 'Mullet (cooked)', nameAr: 'بوري', previousNames: ['Mullet (بوري, cooked)'] })])

    expect(await presets(db)).toMatchObject([{ id: before!.id, name: 'Mullet (cooked)', name_ar: 'بوري' }])
  })

  it('leaves a user\'s own ingredient with the same name alone', async () => {
    await db.execute({
      sql: `INSERT INTO ingredients (user_id, name, unit_type, calories, protein_g, carbs_g, fat_g) VALUES ('u1', 'Koshari', 'weight_100g', 999, 1, 1, 1)`,
      args: [],
    })

    await upsertPresetFoods(db, [food()])

    const mine = await db.execute(`SELECT calories, category FROM ingredients WHERE user_id = 'u1'`)
    expect(mine.rows).toMatchObject([{ calories: 999, category: null }])
    expect(await presets(db)).toHaveLength(1)
  })
})
