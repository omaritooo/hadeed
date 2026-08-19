import type { Client } from '@libsql/client'
import type { Equipment, PresetSplit, PresetSplitDay, PresetSplitExercise } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal } from '~~/shared/types/profile.types'
import type { DayLocation } from '~~/shared/types/split.types'

export interface CreatePresetExerciseInput {
  exerciseId: string
  position: number
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}

export interface CreatePresetDayInput {
  name: string
  dayIndex: number
  location: DayLocation
  targetMuscleIds: number[]
  exercises: CreatePresetExerciseInput[]
}

export interface CreatePresetSplitInput {
  name: string
  description: string | null
  frequencyMinDays: number
  frequencyMaxDays: number
  goal: Goal | null
  experienceLevel: ExperienceLevel | null
  equipment: Equipment
  isPublished: boolean
  days: CreatePresetDayInput[]
}

export interface PresetSplitWithDays extends PresetSplit {
  days: (PresetSplitDay & { exercises: PresetSplitExercise[] })[]
}

export class PresetSplitRepository {
  constructor(private db: Client) {}

  private mapPreset(row: Record<string, unknown>): PresetSplit {
    return {
      id: row.id as number,
      name: row.name as string,
      description: row.description as string | null,
      frequencyMinDays: row.frequency_min_days as number,
      frequencyMaxDays: row.frequency_max_days as number,
      goal: row.goal as Goal | null,
      experienceLevel: row.experience_level as ExperienceLevel | null,
      equipment: row.equipment as Equipment,
      isPublished: Boolean(row.is_published),
    }
  }

  async createWithDays(input: CreatePresetSplitInput): Promise<PresetSplit> {
    const result = await this.db.execute({
      sql: `INSERT INTO preset_splits (name, description, frequency_min_days, frequency_max_days, goal, experience_level, equipment, is_published)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        input.name, input.description, input.frequencyMinDays, input.frequencyMaxDays,
        input.goal, input.experienceLevel, input.equipment, input.isPublished ? 1 : 0,
      ],
    })
    const presetRow = result.rows[0]
    if (!presetRow) throw new Error('Failed to create preset split')
    const preset = this.mapPreset(presetRow as unknown as Record<string, unknown>)

    for (const day of input.days) {
      const dayResult = await this.db.execute({
        sql: 'INSERT INTO preset_split_days (preset_split_id, name, day_index, location) VALUES (?, ?, ?, ?) RETURNING *',
        args: [preset.id, day.name, day.dayIndex, day.location],
      })
      const dayRow = dayResult.rows[0]
      if (!dayRow) throw new Error('Failed to create preset split day')
      const dayId = dayRow.id as number

      for (const muscleId of day.targetMuscleIds) {
        await this.db.execute({
          sql: 'INSERT INTO preset_split_day_muscles (preset_split_day_id, muscle_id) VALUES (?, ?)',
          args: [dayId, muscleId],
        })
      }

      for (const exercise of day.exercises) {
        await this.db.execute({
          sql: `INSERT INTO preset_split_exercises (preset_split_day_id, exercise_id, position, target_sets, target_reps, target_rpe)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [dayId, exercise.exerciseId, exercise.position, exercise.targetSets, exercise.targetReps, exercise.targetRpe],
        })
      }
    }

    return preset
  }

  async findPublished(): Promise<PresetSplit[]> {
    const result = await this.db.execute('SELECT * FROM preset_splits WHERE is_published = 1')
    return result.rows.map(row => this.mapPreset(row as unknown as Record<string, unknown>))
  }

  async findWithDays(presetId: number): Promise<PresetSplitWithDays | null> {
    const presetResult = await this.db.execute({ sql: 'SELECT * FROM preset_splits WHERE id = ?', args: [presetId] })
    const presetRow = presetResult.rows[0]
    if (!presetRow) return null
    const preset = this.mapPreset(presetRow as unknown as Record<string, unknown>)

    const daysResult = await this.db.execute({
      sql: 'SELECT * FROM preset_split_days WHERE preset_split_id = ? ORDER BY day_index',
      args: [presetId],
    })

    const days = await Promise.all(
      daysResult.rows.map(async (dayRow) => {
        const day = dayRow as unknown as Record<string, unknown>
        const dayId = day.id as number

        const musclesResult = await this.db.execute({
          sql: 'SELECT muscle_id FROM preset_split_day_muscles WHERE preset_split_day_id = ?',
          args: [dayId],
        })
        const targetMuscleIds = musclesResult.rows.map(r => (r as unknown as Record<string, unknown>).muscle_id as number)

        const exercisesResult = await this.db.execute({
          sql: 'SELECT * FROM preset_split_exercises WHERE preset_split_day_id = ? ORDER BY position',
          args: [dayId],
        })
        const exercises: PresetSplitExercise[] = exercisesResult.rows.map((exRow) => {
          const ex = exRow as unknown as Record<string, unknown>
          return {
            id: ex.id as number,
            presetSplitDayId: ex.preset_split_day_id as number,
            exerciseId: ex.exercise_id as string,
            position: ex.position as number,
            targetSets: ex.target_sets as number | null,
            targetReps: ex.target_reps as number | null,
            targetRpe: ex.target_rpe as number | null,
          }
        })

        return {
          id: dayId,
          presetSplitId: day.preset_split_id as number,
          name: day.name as string,
          dayIndex: day.day_index as number,
          location: day.location as DayLocation,
          targetMuscleIds,
          exercises,
        }
      }),
    )

    return { ...preset, days }
  }
}
