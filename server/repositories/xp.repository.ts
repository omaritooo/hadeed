import type { Client } from '@libsql/client'
import type { XpSourceType } from '~~/shared/types/gamification.types'

export class XpRepository {
  constructor(private db: Client) {}

  async award(userId: string, amount: number, sourceType: XpSourceType, sourceId: string): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO xp_ledger (user_id, amount, source_type, source_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id, source_type, source_id) DO NOTHING`,
      args: [userId, amount, sourceType, sourceId],
    })
  }

  async totalForUser(userId: string): Promise<number> {
    const result = await this.db.execute({
      sql: 'SELECT COALESCE(SUM(amount), 0) as total FROM xp_ledger WHERE user_id = ?',
      args: [userId],
    })
    const row = result.rows[0]
    return row ? (row.total as number) : 0
  }
}
