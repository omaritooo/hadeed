import type { Client } from '@libsql/client'

export class UserRepository {
  constructor(private db: Client) {}

  // There's no signup flow yet -- requests are identified purely by the x-user-id header (see
  // getRequestContext) -- so the first authenticated write for a given userId is what creates
  // their `users` row. ON CONFLICT (id) DO NOTHING makes this safe to call on every request.
  async ensureExists(userId: string, email: string, displayName?: string): Promise<void> {
    await this.db.execute({
      sql: 'INSERT INTO users (id, email, display_name) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING',
      args: [userId, email, displayName ?? null],
    })
  }

  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    await this.db.execute({
      sql: 'UPDATE users SET display_name = ? WHERE id = ?',
      args: [displayName, userId],
    })
  }

  async findDisplayName(userId: string): Promise<string | null> {
    const result = await this.db.execute({ sql: 'SELECT display_name FROM users WHERE id = ?', args: [userId] })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    return row ? (row.display_name as string | null) : null
  }
}
