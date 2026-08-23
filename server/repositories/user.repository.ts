import type { Client } from '@libsql/client'

export class UserRepository {
  constructor(private db: Client) {}

  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    await this.db.execute({
      sql: 'UPDATE users SET display_name = ? WHERE id = ?',
      args: [displayName, userId],
    })
  }
}
