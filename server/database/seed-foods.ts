import type { Client } from '@libsql/client'
import type { FoodCategory } from '~~/shared/lib/food-categories'

export interface RawPresetFood {
  name: string
  nameAr?: string | null
  category?: FoodCategory | null
  keywords?: string | null
  // Names this preset was seeded under before. A rename updates the existing row instead of
  // inserting a new one, so meals already logged against it stay linked.
  previousNames?: string[]
  unitType: 'weight_100g' | 'count'
  unitLabel: string | null
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

// Presets have no natural stable id (unlike exercises' slug), so they upsert by name among the
// global rows (user_id IS NULL) to stay idempotent across reseeds.
export const upsertPresetFoods = async (db: Client, foods: RawPresetFood[]): Promise<void> => {
  for (const food of foods) {
    const names = [food.name, ...(food.previousNames ?? [])]
    const existing = await db.execute({
      sql: `SELECT id FROM ingredients WHERE user_id IS NULL AND name IN (${names.map(() => '?').join(', ')}) LIMIT 1`,
      args: names,
    })
    const args = [
      food.name, food.nameAr ?? null, food.category ?? null, food.keywords ?? null,
      food.unitType, food.unitLabel, food.calories, food.proteinG, food.carbsG, food.fatG,
    ]
    const existingId = existing.rows[0]?.id as number | undefined
    if (existingId) {
      await db.execute({
        sql: `UPDATE ingredients SET name = ?, name_ar = ?, category = ?, keywords = ?, unit_type = ?, unit_label = ?,
                calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?
              WHERE id = ?`,
        args: [...args, existingId],
      })
    } else {
      await db.execute({
        sql: `INSERT INTO ingredients (user_id, name, name_ar, category, keywords, unit_type, unit_label, calories, protein_g, carbs_g, fat_g)
              VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args,
      })
    }
  }
}
