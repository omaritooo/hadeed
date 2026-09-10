import type { Client } from '@libsql/client'
import type { XpSourceType } from '~~/shared/types/gamification.types'
import type { RecentPr } from '~~/shared/types/home.types'
import type { SessionPrHit } from '~~/shared/types/session.types'

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

  // `limit` omitted returns the full PR history (most recent first) — used by the Stats tab's
  // PR timeline, as opposed to the home/workouts summaries which always pass a small cap.
  async recentPrs(userId: string, limit?: number): Promise<RecentPr[]> {
    const result = await this.db.execute({
      sql: `SELECT xl.created_at AS achieved_at, sl.weight_kg, sl.reps, e.name AS exercise_name
            FROM xp_ledger xl
            JOIN set_logs sl ON sl.id = xl.source_id
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN exercises e ON e.id = el.exercise_id
            WHERE xl.user_id = ? AND xl.source_type = 'pr'
            ORDER BY xl.created_at DESC
            ${limit !== undefined ? 'LIMIT ?' : ''}`,
      args: limit !== undefined ? [userId, limit] : [userId],
    })
    return result.rows.map(row => ({
      exerciseName: row.exercise_name as string,
      weightKg: row.weight_kg as number,
      reps: row.reps as number,
      achievedAt: row.achieved_at as string,
    }))
  }

  /**
   * PRs hit *during a specific session*, for the post-workout summary. Looks up recorded
   * xp_ledger('pr') entries whose source set belongs to this session, rather than re-deriving PR
   * status from set_logs at completion time — by the time a session completes, its own working
   * sets are already in set_logs, so a fresh best-weight lookup could no longer distinguish a PR
   * set from the new baseline it just became. PR detection instead happens once, at log time
   * (see server/api/sessions/[id]/sets.post.ts), and is durably recorded here.
   */
  async findPrsForSession(userId: string, sessionId: string): Promise<SessionPrHit[]> {
    const result = await this.db.execute({
      sql: `SELECT e.name AS exercise_name, sl.weight_kg, sl.reps
            FROM xp_ledger xl
            JOIN set_logs sl ON sl.id = xl.source_id
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN exercises e ON e.id = el.exercise_id
            WHERE xl.user_id = ? AND xl.source_type = 'pr' AND el.session_id = ?
            ORDER BY sl.logged_at ASC`,
      args: [userId, sessionId],
    })
    return result.rows.map(row => ({
      exerciseName: row.exercise_name as string,
      weightKg: row.weight_kg as number,
      reps: row.reps as number,
    }))
  }
}
