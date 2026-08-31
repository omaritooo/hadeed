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

  // xp_ledger already carries one deduplicated row per (userId, sourceType, sourceId) event
  // (see award()'s ON CONFLICT DO NOTHING), so it doubles as a durable count of how many times
  // a given kind of event has happened for this user -- no separate counter table needed.
  async countBySourceType(userId: string, sourceType: XpSourceType): Promise<number> {
    const result = await this.db.execute({
      sql: 'SELECT COUNT(*) as count FROM xp_ledger WHERE user_id = ? AND source_type = ?',
      args: [userId, sourceType],
    })
    const row = result.rows[0]
    return row ? (row.count as number) : 0
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
