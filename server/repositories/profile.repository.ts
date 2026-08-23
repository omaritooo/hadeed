import type { Client } from '@libsql/client'
import type { ActivityLevel, Gender } from '~~/shared/lib/formulas'
import { inToCm, round1 } from '~~/shared/lib/formulas'
import type { Equipment } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal, UnitSystem, UserProfile } from '~~/shared/types/profile.types'

export interface UpsertProfileInput {
  dateOfBirth: string
  gender: Gender
  /** Raw value: cm if the resolved unitSystem is metric, inches if imperial. */
  height: number
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
    // The read (to resolve omitted fields) and the write must happen atomically: useDb() is a
    // remote libsql/Turso client, so without an explicit transaction the SELECT and the INSERT
    // are two independent network round trips, and two concurrent upsert calls for the same
    // userId could each read the same stale snapshot and then lost-update each other.
    const tx = await this.db.transaction('write')
    try {
      const existingResult = await tx.execute({ sql: 'SELECT * FROM user_profiles WHERE user_id = ?', args: [userId] })
      const existingRow = existingResult.rows[0] as unknown as Record<string, unknown> | undefined
      const existing = existingRow ? this.mapRow(existingRow) : null

      const activityLevel = input.activityLevel !== undefined ? input.activityLevel : (existing?.activityLevel ?? null)
      const experienceLevel = input.experienceLevel !== undefined ? input.experienceLevel : (existing?.experienceLevel ?? null)
      const primaryGoal = input.primaryGoal !== undefined ? input.primaryGoal : (existing?.primaryGoal ?? null)
      const trainingDaysPerWeek = input.trainingDaysPerWeek !== undefined ? input.trainingDaysPerWeek : (existing?.trainingDaysPerWeek ?? null)
      const equipment = input.equipment !== undefined ? input.equipment : (existing?.equipment ?? null)
      const unitSystem = input.unitSystem !== undefined ? input.unitSystem : (existing?.unitSystem ?? 'metric')
      const timezone = input.timezone !== undefined ? input.timezone : (existing?.timezone ?? null)

      // Height conversion MUST happen after unitSystem is resolved (above) and inside this same
      // transaction: unitSystem may itself be preserved from the existing row rather than passed
      // explicitly, so converting height against anything read/resolved outside this transaction
      // would reintroduce the TOCTOU race this method exists to close.
      const heightCm = unitSystem === 'imperial' ? round1(inToCm(input.height)) : round1(input.height)

      const result = await tx.execute({
        sql: `INSERT INTO user_profiles
                (user_id, date_of_birth, gender, height_cm, activity_level, experience_level, primary_goal,
                 training_days_per_week, equipment, unit_system, timezone, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
          heightCm,
          activityLevel,
          experienceLevel,
          primaryGoal,
          trainingDaysPerWeek,
          equipment,
          unitSystem,
          timezone,
        ],
      })
      const row = result.rows[0]
      if (!row) throw new Error('Failed to upsert profile')

      await tx.commit()
      return this.mapRow(row as unknown as Record<string, unknown>)
    } finally {
      // Safe to call unconditionally: per @libsql/client's docs this is a no-op if the
      // transaction was already closed by commit(), and rolls back otherwise (error path).
      tx.close()
    }
  }
}
