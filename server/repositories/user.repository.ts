import type { Client } from '@libsql/client'

export class UserRepository {
  constructor(private db: Client) {}

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
