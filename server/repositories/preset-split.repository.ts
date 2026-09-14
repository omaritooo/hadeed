import type { Client } from '@libsql/client'
import type { Equipment, PresetSplit, PresetSplitDay, PresetSplitExercise } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal } from '~~/shared/types/profile.types'
import type { DayLocation, SplitFormat } from '~~/shared/types/split.types'
import { JOINT_AREAS, type JointArea } from '~~/shared/lib/joint-areas'

export interface CreatePresetExerciseInput {
  exerciseId: string
  position: number
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
  restSeconds?: number | null
}

export interface CreatePresetDayInput {
  name: string
  dayIndex: number
  location: DayLocation
  targetMuscleIds: number[]
  format?: SplitFormat
  rounds?: number
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
        sql: 'INSERT INTO preset_split_days (preset_split_id, name, day_index, location, format, rounds) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
        args: [preset.id, day.name, day.dayIndex, day.location, day.format ?? 'straight_sets', day.rounds ?? 1],
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
          sql: `INSERT INTO preset_split_exercises (preset_split_day_id, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [dayId, exercise.exerciseId, exercise.position, exercise.targetSets, exercise.targetReps, exercise.targetRpe, exercise.restSeconds ?? null],
        })
      }
    }

    return preset
  }

  async findPublished(): Promise<PresetSplit[]> {
    const result = await this.db.execute('SELECT * FROM preset_splits WHERE is_published = 1')
    return result.rows.map(row => this.mapPreset(row as unknown as Record<string, unknown>))
  }

  // Per published preset: how many distinct tier-1 exercises load at least one of `areas`, and
  // which areas. Main lifts only, since accessories are cheap to swap and shouldn't sink a preset.
  async countStressedTier1Exercises(areas: readonly JointArea[]): Promise<Map<number, { count: number, areas: JointArea[] }>> {
    if (areas.length === 0) return new Map()
    const placeholders = areas.map(() => '?').join(', ')
    const result = await this.db.execute({
      sql: `SELECT psd.preset_split_id AS preset_id, COUNT(DISTINCT pse.exercise_id) AS n, GROUP_CONCAT(DISTINCT s.area) AS areas
            FROM preset_split_exercises pse
            JOIN preset_split_days psd ON psd.id = pse.preset_split_day_id
            JOIN exercises e ON e.id = pse.exercise_id AND e.tier = 1
            JOIN exercise_stressors s ON s.exercise_id = e.id AND s.area IN (${placeholders})
            GROUP BY psd.preset_split_id`,
      args: [...areas],
    })
    return new Map(result.rows.map((row) => {
      const found = (row.areas as string).split(',')
      return [row.preset_id as number, {
        count: row.n as number,
        areas: JOINT_AREAS.filter(area => found.includes(area)),
      }]
    }))
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
            restSeconds: ex.rest_seconds as number | null,
          }
        })

        return {
          id: dayId,
          presetSplitId: day.preset_split_id as number,
          name: day.name as string,
          dayIndex: day.day_index as number,
          location: day.location as DayLocation,
          targetMuscleIds,
          format: day.format as SplitFormat,
          rounds: day.rounds as number,
          exercises,
        }
      }),
    )

    return { ...preset, days }
  }
}
