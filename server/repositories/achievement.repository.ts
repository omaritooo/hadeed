import type { Client } from '@libsql/client'
import type { Achievement, AchievementCriteriaType } from '~~/shared/types/gamification.types'
import type { UnlockedAchievementSummary } from '~~/shared/types/home.types'

export interface CreateAchievementInput {
  key: string
  name: string
  description: string | null
  icon: string | null
  criteriaType: AchievementCriteriaType
  criteriaValue: Record<string, unknown>
  isPublished: boolean
}

export class AchievementRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): Achievement {
    return {
      id: row.id as number,
      key: row.key as string,
      name: row.name as string,
      description: row.description as string | null,
      icon: row.icon as string | null,
      criteriaType: row.criteria_type as AchievementCriteriaType,
      criteriaValue: JSON.parse(row.criteria_value as string) as Record<string, unknown>,
      isPublished: Boolean(row.is_published),
    }
  }

  async create(input: CreateAchievementInput): Promise<Achievement> {
    const result = await this.db.execute({
      sql: `INSERT INTO achievements (key, name, description, icon, criteria_type, criteria_value, is_published)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [input.key, input.name, input.description, input.icon, input.criteriaType, JSON.stringify(input.criteriaValue), input.isPublished ? 1 : 0],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to create achievement')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }

  async upsertByKey(input: CreateAchievementInput): Promise<Achievement> {
    const result = await this.db.execute({
      sql: `INSERT INTO achievements (key, name, description, icon, criteria_type, criteria_value, is_published)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              icon = excluded.icon,
              criteria_type = excluded.criteria_type,
              criteria_value = excluded.criteria_value,
              is_published = excluded.is_published
            RETURNING *`,
      args: [input.key, input.name, input.description, input.icon, input.criteriaType, JSON.stringify(input.criteriaValue), input.isPublished ? 1 : 0],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to upsert achievement')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }

  async findPublished(): Promise<Achievement[]> {
    const result = await this.db.execute('SELECT * FROM achievements WHERE is_published = 1')
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }

  async findUnlockedKeys(userId: string): Promise<string[]> {
    const result = await this.db.execute({
      sql: `SELECT achievements.key FROM user_achievements
            JOIN achievements ON achievements.id = user_achievements.achievement_id
            WHERE user_achievements.user_id = ?`,
      args: [userId],
    })
    return result.rows.map(r => (r as unknown as Record<string, unknown>).key as string)
  }

  async unlock(userId: string, achievementId: number): Promise<void> {
    await this.db.execute({
      sql: 'INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
      args: [userId, achievementId],
    })
  }

  async findRecentlyUnlocked(userId: string, limit: number): Promise<UnlockedAchievementSummary[]> {
    const result = await this.db.execute({
      sql: `SELECT a.key, a.name, a.icon, ua.unlocked_at
            FROM user_achievements ua
            JOIN achievements a ON a.id = ua.achievement_id
            WHERE ua.user_id = ?
            ORDER BY ua.unlocked_at DESC
            LIMIT ?`,
      args: [userId, limit],
    })
    return result.rows.map((row) => {
      const r = row as unknown as Record<string, unknown>
      return {
        key: r.key as string,
        name: r.name as string,
        icon: r.icon as string | null,
        unlockedAt: r.unlocked_at as string,
      }
    })
  }
}
