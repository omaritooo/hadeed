import { randomBytes } from 'node:crypto'
import type { Client } from '@libsql/client'

export interface AuthSession {
  id: string
  userId: string
}

export class AuthSessionRepository {
  constructor(private db: Client) {}

  async create(userId: string): Promise<AuthSession> {
    const id = randomBytes(32).toString('base64url')
    await this.db.execute({
      sql: "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))",
      args: [id, userId],
    })
    return { id, userId }
  }

  async findValid(sessionId: string): Promise<AuthSession | null> {
    const result = await this.db.execute({
      sql: `SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')`,
      args: [sessionId],
    })
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined
    return row ? { id: sessionId, userId: row.user_id as string } : null
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM sessions WHERE id = ?', args: [sessionId] })
  }
}
