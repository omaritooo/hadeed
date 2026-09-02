import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'

describe('PresetMealRepository', () => {
  let db: Client
  let repo: PresetMealRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({
      sql: `INSERT INTO ingredients (id, user_id, name, unit_type, calories, protein_g, carbs_g, fat_g)
            VALUES (1, 'user-1', 'Chicken breast', 'weight_100g', 165, 31, 0, 3.6)`,
    })
    repo = new PresetMealRepository(db)
  })

  it('creates a preset with items and reads it back', async () => {
    const preset = await repo.create('user-1', { name: 'Post-workout', items: [{ ingredientId: 1, quantity: 200 }] })
    expect(preset.name).toBe('Post-workout')
    expect(preset.items).toEqual([{ id: expect.any(Number), presetMealId: preset.id, ingredientId: 1, quantity: 200 }])
  })

  it('lists only the caller\'s presets, alphabetically, with items', async () => {
    await repo.create('user-1', { name: 'Snack', items: [{ ingredientId: 1, quantity: 50 }] })
    await repo.create('user-1', { name: 'Breakfast', items: [{ ingredientId: 1, quantity: 100 }] })

    const list = await repo.findAllForUser('user-1')
    expect(list.map(p => p.name)).toEqual(['Breakfast', 'Snack'])
    expect(list[0]?.items).toHaveLength(1)
  })

  it('does not find another user\'s preset by id', async () => {
    const preset = await repo.create('user-1', { name: 'Snack', items: [{ ingredientId: 1, quantity: 50 }] })
    expect(await repo.findById(preset.id, 'user-2')).toBeNull()
  })

  it('deletes only the caller\'s own preset', async () => {
    const preset = await repo.create('user-1', { name: 'Snack', items: [{ ingredientId: 1, quantity: 50 }] })
    await repo.delete(preset.id, 'user-2')
    expect(await repo.findById(preset.id, 'user-1')).not.toBeNull()

    await repo.delete(preset.id, 'user-1')
    expect(await repo.findById(preset.id, 'user-1')).toBeNull()
  })
})
