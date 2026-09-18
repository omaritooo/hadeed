import type { Client, InStatement } from '@libsql/client'
import type { DetectedPr, PrType } from '~~/shared/lib/personal-records'
import type { SessionPrHit } from '~~/shared/types/session.types'
import type { RecentPr } from '~~/shared/types/home.types'

export interface InsertPersonalRecordsInput {
  userId: string
  exerciseId: string
  setLogId: string
  achievedAt: string
  prs: DetectedPr[]
}

// Idempotent per (set, type) via the UNIQUE constraint, so replaying a set log -- an offline sync
// retry, say -- records each PR once rather than duplicating the training record. Exposed as
// statements so the backfill script can send a whole history in batches instead of one round trip
// per PR, without a second copy of this insert.
export const personalRecordInsertStatements = (input: InsertPersonalRecordsInput): InStatement[] =>
  input.prs.map(pr => ({
    sql: `INSERT INTO personal_records (user_id, exercise_id, set_log_id, pr_type, value, previous_value, achieved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (set_log_id, pr_type) DO NOTHING`,
    args: [input.userId, input.exerciseId, input.setLogId, pr.type, pr.value, pr.previousValue, input.achievedAt],
  }))

export class PersonalRecordRepository {
  constructor(private db: Client) {}

  async insertMany(input: InsertPersonalRecordsInput): Promise<void> {
    for (const statement of personalRecordInsertStatements(input)) {
      await this.db.execute(statement)
    }
  }

  async deleteForSet(setLogId: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM personal_records WHERE set_log_id = ?', args: [setLogId] })
  }

  // One row per PR *set*, with its PR types folded together, so "Bench 100kg x 5" appears once
  // even when it was simultaneously a weight and an e1RM PR.
  private groupedSql(where: string, limit: boolean): string {
    return `SELECT e.name AS exercise_name, sl.weight_kg, sl.reps, MAX(pr.achieved_at) AS achieved_at,
                   GROUP_CONCAT(pr.pr_type) AS pr_types,
                   MAX(CASE WHEN pr.pr_type = 'e1rm' THEN pr.value END) AS e1rm_kg
            FROM personal_records pr
            JOIN set_logs sl ON sl.id = pr.set_log_id
            JOIN exercise_logs el ON el.id = sl.exercise_log_id
            JOIN exercises e ON e.id = pr.exercise_id
            WHERE ${where}
            GROUP BY pr.set_log_id
            ORDER BY achieved_at DESC, sl.rowid DESC
            ${limit ? 'LIMIT ?' : ''}`
  }

  private mapHit(row: Record<string, unknown>): SessionPrHit {
    return {
      exerciseName: row.exercise_name as string,
      weightKg: row.weight_kg as number,
      reps: row.reps as number,
      prTypes: (row.pr_types as string).split(',').sort() as PrType[],
      e1rmKg: (row.e1rm_kg as number | null) ?? null,
    }
  }

  async findForSession(userId: string, sessionId: string): Promise<SessionPrHit[]> {
    const result = await this.db.execute({
      sql: this.groupedSql('pr.user_id = ? AND el.session_id = ?', false),
      args: [userId, sessionId],
    })
    return result.rows.map(row => this.mapHit(row as unknown as Record<string, unknown>))
  }

  // `limit` omitted returns the full PR history (most recent first) -- used by the Stats tab's
  // PR timeline, as opposed to the home/workouts summaries which always pass a small cap.
  async recent(userId: string, limit?: number): Promise<RecentPr[]> {
    const result = await this.db.execute({
      sql: this.groupedSql('pr.user_id = ?', limit !== undefined),
      args: limit !== undefined ? [userId, limit] : [userId],
    })
    return result.rows.map((row) => {
      const record = row as unknown as Record<string, unknown>
      return { ...this.mapHit(record), achievedAt: record.achieved_at as string }
    })
  }
}
