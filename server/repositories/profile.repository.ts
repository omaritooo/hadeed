import type { Client } from '@libsql/client'
import type { ActivityLevel, Gender } from '~~/shared/lib/formulas'
import type { Equipment } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal, UnitSystem, UserProfile } from '~~/shared/types/profile.types'

export interface UpsertProfileInput {
  dateOfBirth: string
  gender: Gender
  heightCm: number
  activityLevel?: ActivityLevel | null
  experienceLevel?: ExperienceLevel | null
  primaryGoal?: Goal | null
  trainingDaysPerWeek?: number | null
  equipment?: Equipment | null
  unitSystem?: UnitSystem
  timezone?: string | null
}

export class ProfileRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): UserProfile {
    return {
      userId: row.user_id as string,
      dateOfBirth: row.date_of_birth as string,
      gender: row.gender as Gender,
      heightCm: row.height_cm as number,
      activityLevel: row.activity_level as ActivityLevel | null,
      experienceLevel: row.experience_level as ExperienceLevel | null,
      primaryGoal: row.primary_goal as Goal | null,
      trainingDaysPerWeek: row.training_days_per_week as number | null,
      equipment: row.equipment as Equipment | null,
      unitSystem: row.unit_system as UnitSystem,
      timezone: row.timezone as string | null,
      updatedAt: row.updated_at as string,
    }
  }

  async findByUserId(userId: string): Promise<UserProfile | null> {
    const result = await this.db.execute({ sql: 'SELECT * FROM user_profiles WHERE user_id = ?', args: [userId] })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async upsert(userId: string, input: UpsertProfileInput): Promise<UserProfile> {
    const result = await this.db.execute({
      sql: `INSERT INTO user_profiles
              (user_id, date_of_birth, gender, height_cm, activity_level, experience_level, primary_goal,
               training_days_per_week, equipment, unit_system, timezone, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'metric'), ?, datetime('now'))
            ON CONFLICT (user_id) DO UPDATE SET
              date_of_birth = excluded.date_of_birth,
              gender = excluded.gender,
              height_cm = excluded.height_cm,
              activity_level = excluded.activity_level,
              experience_level = excluded.experience_level,
              primary_goal = excluded.primary_goal,
              training_days_per_week = excluded.training_days_per_week,
              equipment = excluded.equipment,
              unit_system = excluded.unit_system,
              timezone = excluded.timezone,
              updated_at = datetime('now')
            RETURNING *`,
      args: [
        userId,
        input.dateOfBirth,
        input.gender,
        input.heightCm,
        input.activityLevel ?? null,
        input.experienceLevel ?? null,
        input.primaryGoal ?? null,
        input.trainingDaysPerWeek ?? null,
        input.equipment ?? null,
        input.unitSystem ?? null,
        input.timezone ?? null,
      ],
    })
    const row = result.rows[0]
    if (!row) throw new Error('Failed to upsert profile')
    return this.mapRow(row as unknown as Record<string, unknown>)
  }
}
