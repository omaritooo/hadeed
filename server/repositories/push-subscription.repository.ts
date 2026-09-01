import type { Client } from '@libsql/client'
import type { PushSubscriptionInput, PushSubscriptionRecord } from '~~/shared/types/push.types'

export class PushSubscriptionRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): PushSubscriptionRecord {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      endpoint: row.endpoint as string,
      p256dhKey: row.p256dh_key as string,
      authKey: row.auth_key as string,
      createdAt: row.created_at as string,
    }
  }

  async save(userId: string, subscription: PushSubscriptionInput): Promise<PushSubscriptionRecord> {
    const result = await this.db.execute({
      sql: `INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (endpoint) DO UPDATE SET
              user_id = excluded.user_id, p256dh_key = excluded.p256dh_key, auth_key = excluded.auth_key
            RETURNING *`,
      args: [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to save push subscription')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [endpoint] })
  }

  async findByUserId(userId: string): Promise<PushSubscriptionRecord[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM push_subscriptions WHERE user_id = ?', args: [userId] })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }
}
