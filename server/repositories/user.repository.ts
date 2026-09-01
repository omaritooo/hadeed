import type { Client } from '@libsql/client'

export interface UserWithPasswordHash {
  id: string
  email: string
  passwordHash: string | null
}

export class UserRepository {
  constructor(private db: Client) {}

  async ensureExists(userId: string, email: string, passwordHash: string, displayName?: string): Promise<void> {
    await this.db.execute({
      sql: 'INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
      args: [userId, email, passwordHash, displayName ?? null],
    })
  }

  async findByEmail(email: string): Promise<UserWithPasswordHash | null> {
    const result = await this.db.execute({
      sql: 'SELECT id, email, password_hash FROM users WHERE email = ?',
      args: [email],
    })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    if (!row) return null
    return { id: row.id as string, email: row.email as string, passwordHash: row.password_hash as string | null }
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
