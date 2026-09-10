import type { Client } from '@libsql/client'
import type { MealLog, MealLogItem } from '~~/shared/types/nutrition.types'

export interface MealLogItemInput {
  ingredientId: number
  ingredientName: string
  quantity: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export class MealLogRepository {
  constructor(private db: Client) {}

  private mapLog(row: Record<string, unknown>): Omit<MealLog, 'items'> {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      name: row.name as string | null,
      loggedAt: row.logged_at as string,
    }
  }

  private mapItem(row: Record<string, unknown>): MealLogItem {
    return {
      id: row.id as number,
      mealLogId: row.meal_log_id as number,
      ingredientId: row.ingredient_id as number | null,
      ingredientName: row.ingredient_name as string,
      quantity: row.quantity as number,
      calories: row.calories as number,
      proteinG: row.protein_g as number,
      carbsG: row.carbs_g as number,
      fatG: row.fat_g as number,
    }
  }

  private async loadItems(mealLogId: number): Promise<MealLogItem[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM meal_log_items WHERE meal_log_id = ?', args: [mealLogId] })
    return result.rows.map(row => this.mapItem(row as unknown as Record<string, unknown>))
  }

  async log(userId: string, name: string | null, items: MealLogItemInput[]): Promise<MealLog> {
    const result = await this.db.execute({
      sql: 'INSERT INTO meal_logs (user_id, name) VALUES (?, ?) RETURNING *',
      args: [userId, name],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to log meal')
    const mealLog = this.mapLog(row as unknown as Record<string, unknown>)

    for (const item of items) {
      await this.db.execute({
        sql: `INSERT INTO meal_log_items (meal_log_id, ingredient_id, ingredient_name, quantity, calories, protein_g, carbs_g, fat_g)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [mealLog.id, item.ingredientId, item.ingredientName, item.quantity, item.calories, item.proteinG, item.carbsG, item.fatG],
      })
    }

    return { ...mealLog, items: await this.loadItems(mealLog.id) }
  }

  // Wholesale replacement of a meal's items (delete-then-reinsert) rather than diffing
  // individual item rows -- simpler and safer, matching this codebase's general preference
  // for replacing a whole block over fine-grained patching. Returns null if the meal log
  // doesn't exist or isn't owned by this user (mirrors delete's ownership scoping).
  async replaceItems(id: number, userId: string, items: MealLogItemInput[]): Promise<MealLog | null> {
    const existing = await this.db.execute({ sql: 'SELECT * FROM meal_logs WHERE id = ? AND user_id = ?', args: [id, userId] })
    const row = existing.rows[0]
    if (!row) return null
    const mealLog = this.mapLog(row as unknown as Record<string, unknown>)

    await this.db.execute({ sql: 'DELETE FROM meal_log_items WHERE meal_log_id = ?', args: [id] })
    for (const item of items) {
      await this.db.execute({
        sql: `INSERT INTO meal_log_items (meal_log_id, ingredient_id, ingredient_name, quantity, calories, protein_g, carbs_g, fat_g)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, item.ingredientId, item.ingredientName, item.quantity, item.calories, item.proteinG, item.carbsG, item.fatG],
      })
    }

    return { ...mealLog, items: await this.loadItems(id) }
  }

  async findForRange(userId: string, startIso: string, endIso: string): Promise<MealLog[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM meal_logs WHERE user_id = ? AND logged_at >= ? AND logged_at < ? ORDER BY logged_at',
      args: [userId, startIso, endIso],
    })
    const logs = result.rows.map(row => this.mapLog(row as unknown as Record<string, unknown>))
    return Promise.all(logs.map(async log => ({ ...log, items: await this.loadItems(log.id) })))
  }

  async delete(id: number, userId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM meal_logs WHERE id = ? AND user_id = ?', args: [id, userId] })
  }
}
