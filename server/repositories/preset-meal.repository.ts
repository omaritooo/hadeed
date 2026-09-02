import type { Client } from '@libsql/client'
import type { PresetMeal, PresetMealItem } from '~~/shared/types/nutrition.types'

export interface CreatePresetMealInput {
  name: string
  items: { ingredientId: number, quantity: number }[]
}

export class PresetMealRepository {
  constructor(private db: Client) {}

  private mapPreset(row: Record<string, unknown>): Omit<PresetMeal, 'items'> {
    return { id: row.id as number, userId: row.user_id as string, name: row.name as string }
  }

  private mapItem(row: Record<string, unknown>): PresetMealItem {
    return {
      id: row.id as number,
      presetMealId: row.preset_meal_id as number,
      ingredientId: row.ingredient_id as number,
      quantity: row.quantity as number,
    }
  }

  private async loadItems(presetMealId: number): Promise<PresetMealItem[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM preset_meal_items WHERE preset_meal_id = ?', args: [presetMealId] })
    return result.rows.map(row => this.mapItem(row as unknown as Record<string, unknown>))
  }

  async create(userId: string, input: CreatePresetMealInput): Promise<PresetMeal> {
    const result = await this.db.execute({
      sql: 'INSERT INTO preset_meals (user_id, name) VALUES (?, ?) RETURNING *',
      args: [userId, input.name],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to create preset meal')
    const preset = this.mapPreset(row as unknown as Record<string, unknown>)

    for (const item of input.items) {
      await this.db.execute({
        sql: 'INSERT INTO preset_meal_items (preset_meal_id, ingredient_id, quantity) VALUES (?, ?, ?)',
        args: [preset.id, item.ingredientId, item.quantity],
      })
    }

    return { ...preset, items: await this.loadItems(preset.id) }
  }

  async findAllForUser(userId: string): Promise<PresetMeal[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM preset_meals WHERE user_id = ? ORDER BY name', args: [userId] })
    const presets = result.rows.map(row => this.mapPreset(row as unknown as Record<string, unknown>))
    return Promise.all(presets.map(async preset => ({ ...preset, items: await this.loadItems(preset.id) })))
  }

  async findById(id: number, userId: string): Promise<PresetMeal | null> {
    const result = await this.db.execute({ sql: 'SELECT * FROM preset_meals WHERE id = ? AND user_id = ?', args: [id, userId] })
    const row = result.rows[0]
    if (!row) return null
    const preset = this.mapPreset(row as unknown as Record<string, unknown>)
    return { ...preset, items: await this.loadItems(preset.id) }
  }

  async delete(id: number, userId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM preset_meals WHERE id = ? AND user_id = ?', args: [id, userId] })
  }
}
