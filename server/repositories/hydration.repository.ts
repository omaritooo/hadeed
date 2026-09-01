import type { Client } from '@libsql/client'
import type { HydrationLog } from '~~/shared/types/hydration.types'

export class HydrationRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): HydrationLog {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      amountMl: row.amount_ml as number,
      loggedAt: row.logged_at as string,
    }
  }

  async log(userId: string, amountMl: number): Promise<HydrationLog> {
    const result = await this.db.execute({
      sql: 'INSERT INTO hydration_logs (user_id, amount_ml) VALUES (?, ?) RETURNING *',
      args: [userId, amountMl],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to log hydration intake')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }

  async findForRange(userId: string, startIso: string, endIso: string): Promise<HydrationLog[]> {
    const result = await this.db.execute({
      sql: `SELECT * FROM hydration_logs WHERE user_id = ? AND logged_at >= ? AND logged_at < ? ORDER BY logged_at`,
      args: [userId, startIso, endIso],
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }

  async delete(id: number, userId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM hydration_logs WHERE id = ? AND user_id = ?', args: [id, userId] })
  }
}
