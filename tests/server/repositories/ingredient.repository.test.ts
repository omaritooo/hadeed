import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'

describe('IngredientRepository', () => {
  let db: Client
  let repo: IngredientRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    repo = new IngredientRepository(db)
  })

  const chicken = {
    name: 'Chicken breast',
    unitType: 'weight_100g' as const,
    unitLabel: null,
    calories: 165,
    proteinG: 31,
    carbsG: 0,
    fatG: 3.6,
  }

  it('creates an ingredient and reads it back', async () => {
    const created = await repo.create('user-1', chicken)
    expect(created.id).toBeGreaterThan(0)

    const found = await repo.findById(created.id, 'user-1')
    expect(found).toMatchObject(chicken)
  })

  it('lists only the caller\'s ingredients, alphabetically', async () => {
    await repo.create('user-1', { ...chicken, name: 'Rice' })
    await repo.create('user-1', { ...chicken, name: 'Chicken breast' })
    await repo.create('user-2', { ...chicken, name: 'Other user ingredient' })

    const list = await repo.findAllForUser('user-1')
    expect(list.map(i => i.name)).toEqual(['Chicken breast', 'Rice'])
  })

  it('does not find another user\'s ingredient by id', async () => {
    const created = await repo.create('user-1', chicken)
    expect(await repo.findById(created.id, 'user-2')).toBeNull()
  })

  it('updates only the provided fields', async () => {
    const created = await repo.create('user-1', chicken)
    const updated = await repo.update(created.id, 'user-1', { calories: 200 })
    expect(updated).toMatchObject({ ...chicken, calories: 200 })
  })

  it('does not update another user\'s ingredient', async () => {
    const created = await repo.create('user-1', chicken)
    const updated = await repo.update(created.id, 'user-2', { calories: 200 })
    expect(updated).toBeNull()
  })

  it('deletes only the caller\'s own ingredient', async () => {
    const created = await repo.create('user-1', chicken)
    await repo.delete(created.id, 'user-2')
    expect(await repo.findById(created.id, 'user-1')).not.toBeNull()

    await repo.delete(created.id, 'user-1')
    expect(await repo.findById(created.id, 'user-1')).toBeNull()
  })

  const createPreset = async (name: string): Promise<number> => {
    const result = await db.execute({
      sql: `INSERT INTO ingredients (user_id, name, unit_type, unit_label, calories, protein_g, carbs_g, fat_g)
            VALUES (NULL, ?, 'weight_100g', NULL, 100, 10, 10, 5) RETURNING id`,
      args: [name],
    })
    return result.rows[0]!.id as number
  }

  it('lists global preset foods (user_id IS NULL) alongside the caller\'s own ingredients', async () => {
    await createPreset('Apple')
    await repo.create('user-1', { ...chicken, name: 'Chicken breast' })

    const list = await repo.findAllForUser('user-1')
    expect(list.map(i => i.name)).toEqual(['Apple', 'Chicken breast'])
  })

  it('finds a preset food by id for any user', async () => {
    const presetId = await createPreset('Apple')
    expect(await repo.findById(presetId, 'user-1')).toMatchObject({ name: 'Apple', userId: null })
    expect(await repo.findById(presetId, 'user-2')).toMatchObject({ name: 'Apple', userId: null })
  })

  it('does not let a user update a preset food', async () => {
    const presetId = await createPreset('Apple')
    expect(await repo.update(presetId, 'user-1', { calories: 999 })).toBeNull()
  })

  it('does not let a user delete a preset food', async () => {
    const presetId = await createPreset('Apple')
    await repo.delete(presetId, 'user-1')
    expect(await repo.findById(presetId, 'user-1')).not.toBeNull()
  })
})
