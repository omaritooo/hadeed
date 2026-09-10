import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { IngredientRepository } from '~~/server/repositories/ingredient.repository'
import { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import { PresetMealRepository } from '~~/server/repositories/preset-meal.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { NutritionService } from '~~/server/services/nutrition.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

describe('NutritionService', () => {
  let db: Client
  let service: NutritionService
  let ingredients: IngredientRepository
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    ingredients = new IngredientRepository(db)
    const profiles = new ProfileRepository(db)
    // setTarget/getToday require an existing user_profiles row (set by onboarding in the
    // real app); seed one here the same way tests/server/repositories/profile.repository.test.ts does.
    await profiles.upsert('user-1', { dateOfBirth: '1995-01-01', gender: 'male', height: 180 })
    service = new NutritionService(
      ctx,
      ingredients,
      new MealLogRepository(db),
      new PresetMealRepository(db),
      profiles,
    )
  })

  it('rejects an ingredient with a negative macro', async () => {
    await expect(service.createIngredient({
      name: 'Bad', unitType: 'weight_100g', unitLabel: null, calories: -1, proteinG: 0, carbsG: 0, fatG: 0,
    })).rejects.toThrow()
  })

  it('rejects a count-type ingredient with no unit label', async () => {
    await expect(service.createIngredient({
      name: 'Bad', unitType: 'count', unitLabel: null, calories: 100, proteinG: 1, carbsG: 1, fatG: 1,
    })).rejects.toThrow()
    await expect(service.createIngredient({
      name: 'Bad', unitType: 'count', unitLabel: '   ', calories: 100, proteinG: 1, carbsG: 1, fatG: 1,
    })).rejects.toThrow()
  })

  it('rejects switching an ingredient to count type without supplying a unit label', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    await expect(service.updateIngredient(chicken.id, { unitType: 'count' })).rejects.toThrow()
  })

  it('rejects blanking out the unit label on an existing count-type ingredient', async () => {
    const beans = await service.createIngredient({
      name: 'Black beans (can)', unitType: 'count', unitLabel: 'can', calories: 350, proteinG: 21, carbsG: 63, fatG: 1.5,
    })
    await expect(service.updateIngredient(beans.id, { unitLabel: null })).rejects.toThrow()
  })

  it('allows patching an unrelated field on a count-type ingredient without re-supplying the label', async () => {
    const beans = await service.createIngredient({
      name: 'Black beans (can)', unitType: 'count', unitLabel: 'can', calories: 350, proteinG: 21, carbsG: 63, fatG: 1.5,
    })
    const updated = await service.updateIngredient(beans.id, { calories: 360 })
    expect(updated).toMatchObject({ calories: 360, unitType: 'count', unitLabel: 'can' })
  })

  it('allows switching to count type when a unit label is supplied in the same update', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    const updated = await service.updateIngredient(chicken.id, { unitType: 'count', unitLabel: 'breast' })
    expect(updated).toMatchObject({ unitType: 'count', unitLabel: 'breast' })
  })

  it('still 404s updating an unknown ingredient even when the update touches unitType/unitLabel', async () => {
    await expect(service.updateIngredient(999, { unitType: 'count', unitLabel: 'can' })).rejects.toThrow()
  })

  it('scales a weight_100g ingredient by grams / 100 when logging', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })

    const log = await service.logMeal('Lunch', [{ ingredientId: chicken.id, quantity: 150 }])
    expect(log.items[0]).toMatchObject({ calories: 247.5, proteinG: 46.5, carbsG: 0, fatG: 5.4 })
  })

  it('scales a count ingredient by quantity directly when logging', async () => {
    const beans = await service.createIngredient({
      name: 'Black beans (can)', unitType: 'count', unitLabel: 'can', calories: 350, proteinG: 21, carbsG: 63, fatG: 1.5,
    })

    const log = await service.logMeal('Dinner', [{ ingredientId: beans.id, quantity: 2 }])
    expect(log.items[0]).toMatchObject({ calories: 700, proteinG: 42, carbsG: 126, fatG: 3 })
  })

  it('uses an explicitly provided meal type instead of inferring one', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    const log = await service.logMeal('Midnight snack', [{ ingredientId: chicken.id, quantity: 100 }], 'snack')
    expect(log.mealType).toBe('snack')
  })

  it('infers a meal type from the current time of day when none is provided', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    const log = await service.logMeal('Lunch', [{ ingredientId: chicken.id, quantity: 100 }])
    expect(['breakfast', 'lunch', 'dinner', 'snack']).toContain(log.mealType)
  })

  it('rejects logging an unknown ingredient', async () => {
    await expect(service.logMeal('Lunch', [{ ingredientId: 999, quantity: 100 }])).rejects.toThrow()
  })

  it('rejects logging a meal with no items', async () => {
    await expect(service.logMeal('Lunch', [])).rejects.toThrow()
  })

  it('rejects logging a non-positive quantity', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    await expect(service.logMeal('Lunch', [{ ingredientId: chicken.id, quantity: 0 }])).rejects.toThrow()
  })

  it('rejects creating a preset meal with another user\'s ingredient', async () => {
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    const othersChicken = await ingredients.create('user-2', {
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })

    await expect(service.createPresetMeal({
      name: 'Stolen', items: [{ ingredientId: othersChicken.id, quantity: 100 }],
    })).rejects.toThrow()
  })

  it('rejects creating a preset meal with an unknown ingredient', async () => {
    await expect(service.createPresetMeal({
      name: 'Bogus', items: [{ ingredientId: 999, quantity: 100 }],
    })).rejects.toThrow()
  })

  it('logs a preset meal by resolving its saved items against current ingredient macros', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    const preset = await service.createPresetMeal({ name: 'Post-workout', items: [{ ingredientId: chicken.id, quantity: 200 }] })

    const log = await service.logPresetMeal(preset.id)
    expect(log.name).toBe('Post-workout')
    expect(log.items[0]).toMatchObject({ calories: 330, proteinG: 62 })
  })

  it('computes today\'s totals, target, and signed remaining (which can go negative)', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    await service.setTarget({ calories: 300, proteinG: 40, carbsG: 250, fatG: 70 })
    await service.logMeal('Lunch', [{ ingredientId: chicken.id, quantity: 200 }])

    const today = await service.getToday()
    expect(today.totals).toMatchObject({ calories: 330, proteinG: 62 })
    expect(today.target).toEqual({ calories: 300, proteinG: 40, carbsG: 250, fatG: 70 })
    // over target on calories and protein -> negative remaining, not clamped to 0
    expect(today.remaining?.calories).toBeCloseTo(-30)
    expect(today.remaining?.proteinG).toBeCloseTo(-22)
  })

  it('returns a null target and null remaining when no target is set', async () => {
    const today = await service.getToday()
    expect(today.target).toBeNull()
    expect(today.remaining).toBeNull()
  })

  it('deletes a meal log', async () => {
    const chicken = await service.createIngredient({
      name: 'Chicken breast', unitType: 'weight_100g', unitLabel: null, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    })
    const log = await service.logMeal('Lunch', [{ ingredientId: chicken.id, quantity: 100 }])
    await service.deleteMealLog(log.id)

    const today = await service.getToday()
    expect(today.meals).toHaveLength(0)
  })
})
