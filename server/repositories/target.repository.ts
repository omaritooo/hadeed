import type { Client } from '@libsql/client'
import type { TargetMetric, UserTarget } from '~~/shared/types/profile.types'

export interface CreateTargetInput {
  metric: TargetMetric
  targetValue: number
  targetDate?: string | null
  startingValue: number
  startingRecordedAt: string
}

export class TargetRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): UserTarget {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      metric: row.metric as TargetMetric,
      targetValue: row.target_value as number,
      targetDate: row.target_date as string | null,
      startingValue: row.starting_value as number,
      startingRecordedAt: row.starting_recorded_at as string,
      achievedAt: row.achieved_at as string | null,
      isActive: Boolean(row.is_active),
    }
  }

  async create(userId: string, input: CreateTargetInput): Promise<UserTarget> {
    const result = await this.db.execute({
      sql: `INSERT INTO user_targets (user_id, metric, target_value, target_date, starting_value, starting_recorded_at, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING *`,
      args: [userId, input.metric, input.targetValue, input.targetDate ?? null, input.startingValue, input.startingRecordedAt],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to create target')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }

  async findActiveForUser(userId: string): Promise<UserTarget[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM user_targets WHERE user_id = ? AND is_active = 1',
      args: [userId],
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }

  async markAchieved(id: number): Promise<void> {
    await this.db.execute({
      sql: `UPDATE user_targets SET achieved_at = datetime('now'), is_active = 0 WHERE id = ?`,
      args: [id],
    })
  }
}
