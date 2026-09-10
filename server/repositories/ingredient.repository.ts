import type { Client } from '@libsql/client'
import type { Ingredient, IngredientUnitType } from '~~/shared/types/nutrition.types'

export interface CreateIngredientInput {
  name: string
  unitType: IngredientUnitType
  unitLabel: string | null
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export type UpdateIngredientInput = Partial<CreateIngredientInput>

const COLUMN_FOR: Record<keyof CreateIngredientInput, string> = {
  name: 'name',
  unitType: 'unit_type',
  unitLabel: 'unit_label',
  calories: 'calories',
  proteinG: 'protein_g',
  carbsG: 'carbs_g',
  fatG: 'fat_g',
}

export class IngredientRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): Ingredient {
    return {
      id: row.id as number,
      userId: row.user_id as string | null,
      name: row.name as string,
      unitType: row.unit_type as IngredientUnitType,
      unitLabel: row.unit_label as string | null,
      calories: row.calories as number,
      proteinG: row.protein_g as number,
      carbsG: row.carbs_g as number,
      fatG: row.fat_g as number,
    }
  }

  async create(userId: string, input: CreateIngredientInput): Promise<Ingredient> {
    const result = await this.db.execute({
      sql: `INSERT INTO ingredients (user_id, name, unit_type, unit_label, calories, protein_g, carbs_g, fat_g)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [userId, input.name, input.unitType, input.unitLabel, input.calories, input.proteinG, input.carbsG, input.fatG],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to create ingredient')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }

  // Includes global preset foods (user_id IS NULL) alongside the caller's own
  // ingredients, so presets are searchable/selectable the same way as anything
  // the user created themselves.
  async findAllForUser(userId: string): Promise<Ingredient[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM ingredients WHERE user_id = ? OR user_id IS NULL ORDER BY name',
      args: [userId],
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }

  async findById(id: number, userId: string): Promise<Ingredient | null> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM ingredients WHERE id = ? AND (user_id = ? OR user_id IS NULL)',
      args: [id, userId],
    })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async update(id: number, userId: string, input: UpdateIngredientInput): Promise<Ingredient | null> {
    const entries = (Object.entries(input) as [keyof CreateIngredientInput, unknown][]).filter(([, v]) => v !== undefined)
    if (!entries.length) return this.findById(id, userId)

    const sql = `UPDATE ingredients SET ${entries.map(([k]) => `${COLUMN_FOR[k]} = ?`).join(', ')} WHERE id = ? AND user_id = ? RETURNING *`
    const result = await this.db.execute({ sql, args: [...entries.map(([, v]) => v as never), id, userId] })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async delete(id: number, userId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM ingredients WHERE id = ? AND user_id = ?', args: [id, userId] })
  }
}
