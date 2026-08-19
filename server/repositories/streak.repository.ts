import type { Client } from '@libsql/client'
import type { Streak } from '~~/shared/types/gamification.types'

export class StreakRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): Streak {
    return {
      userId: row.user_id as string,
      currentStreak: row.current_streak as number,
      longestStreak: row.longest_streak as number,
      lastActiveDate: row.last_active_date as string | null,
    }
  }

  async findForUser(userId: string): Promise<Streak> {
    const result = await this.db.execute({ sql: 'SELECT * FROM streaks WHERE user_id = ?', args: [userId] })
    const row = result.rows[0]
    if (row) return this.mapRow(row as unknown as Record<string, unknown>)
    return { userId, currentStreak: 0, longestStreak: 0, lastActiveDate: null }
  }

  async recordActiveDay(userId: string, date: string): Promise<Streak> {
    const current = await this.findForUser(userId)
    const nextCurrent = current.currentStreak + 1
    const nextLongest = Math.max(current.longestStreak, nextCurrent)

    const result = await this.db.execute({
      sql: `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET
              current_streak = excluded.current_streak,
              longest_streak = excluded.longest_streak,
              last_active_date = excluded.last_active_date
            RETURNING *`,
      args: [userId, nextCurrent, nextLongest, date],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to record active day')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }

  async reset(userId: string): Promise<void> {
    const current = await this.findForUser(userId)
    await this.db.execute({
      sql: `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
            VALUES (?, 0, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET current_streak = 0`,
      args: [userId, current.longestStreak, current.lastActiveDate],
    })
  }
}
