import type { Client } from '@libsql/client'
import type { Block, MacroTarget, SetType, SplitDay, SplitExercise } from '~~/shared/types/split.types'

export interface CreateSplitExerciseInput {
  exerciseId: string
  position: number
  setType: SetType
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}

export interface CreateSplitDayInput {
  name: string
  dayOfWeek: number
  location: 'gym' | 'home'
  exercises: CreateSplitExerciseInput[]
}

export interface CreateBlockInput {
  programId: number | null
  name: string
  startDate: string
  endDate: string | null
  trainingDayMacroTarget: MacroTarget | null
  restDayMacroTarget: MacroTarget | null
  days: CreateSplitDayInput[]
}

export interface BlockWithDays extends Block {
  days: (SplitDay & { exercises: SplitExercise[] })[]
}

export class BlockRepository {
  constructor(private db: Client) {}

  private mapBlock(row: Record<string, unknown>): Block {
    return {
      id: row.id as number,
      programId: row.program_id as number,
      userId: row.user_id as string,
      name: row.name as string,
      startDate: row.start_date as string,
      endDate: row.end_date as string | null,
      trainingDayMacroTarget: row.training_day_macro_target ? JSON.parse(row.training_day_macro_target as string) : null,
      restDayMacroTarget: row.rest_day_macro_target ? JSON.parse(row.rest_day_macro_target as string) : null,
    }
  }

  async createWithDays(userId: string, input: CreateBlockInput): Promise<Block> {
    let programId = input.programId
    if (programId === null) {
      const program = await this.db.execute({
        sql: 'INSERT INTO programs (user_id, name) VALUES (?, ?) RETURNING *',
        args: [userId, input.name],
      })
      const programRow = program.rows[0]
      if (!programRow) throw new Error('Failed to create implicit program')
      programId = programRow.id as number
    }

    const blockResult = await this.db.execute({
      sql: `INSERT INTO blocks (program_id, user_id, name, start_date, end_date, training_day_macro_target, rest_day_macro_target)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        programId,
        userId,
        input.name,
        input.startDate,
        input.endDate,
        input.trainingDayMacroTarget ? JSON.stringify(input.trainingDayMacroTarget) : null,
        input.restDayMacroTarget ? JSON.stringify(input.restDayMacroTarget) : null,
      ],
    })
    const blockRow = blockResult.rows[0]
    if (!blockRow) throw new Error('Failed to create block')
    const block = this.mapBlock(blockRow as unknown as Record<string, unknown>)

    for (const day of input.days) {
      const dayResult = await this.db.execute({
        sql: 'INSERT INTO split_days (block_id, name, day_of_week, location) VALUES (?, ?, ?, ?) RETURNING *',
        args: [block.id, day.name, day.dayOfWeek, day.location],
      })
      const dayRow = dayResult.rows[0]
      if (!dayRow) throw new Error('Failed to create split day')
      const dayId = dayRow.id as number

      for (const exercise of day.exercises) {
        await this.db.execute({
          sql: `INSERT INTO split_exercises (split_day_id, exercise_id, position, set_type, target_sets, target_reps, target_rpe)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [dayId, exercise.exerciseId, exercise.position, exercise.setType, exercise.targetSets, exercise.targetReps, exercise.targetRpe],
        })
      }
    }

    return block
  }

  async findWithDays(blockId: number): Promise<BlockWithDays | null> {
    const blockResult = await this.db.execute({ sql: 'SELECT * FROM blocks WHERE id = ?', args: [blockId] })
    const blockRow = blockResult.rows[0]
    if (!blockRow) return null
    const block = this.mapBlock(blockRow as unknown as Record<string, unknown>)

    const daysResult = await this.db.execute({ sql: 'SELECT * FROM split_days WHERE block_id = ? ORDER BY day_of_week', args: [blockId] })
    const days = await Promise.all(
      daysResult.rows.map(async (dayRow) => {
        const day = dayRow as unknown as Record<string, unknown>
        const dayId = day.id as number
        const exercisesResult = await this.db.execute({
          sql: 'SELECT * FROM split_exercises WHERE split_day_id = ? ORDER BY position',
          args: [dayId],
        })
        const exercises: SplitExercise[] = exercisesResult.rows.map((exRow) => {
          const ex = exRow as unknown as Record<string, unknown>
          return {
            id: ex.id as number,
            splitDayId: ex.split_day_id as number,
            exerciseId: ex.exercise_id as string,
            position: ex.position as number,
            setType: ex.set_type as SetType,
            targetSets: ex.target_sets as number | null,
            targetReps: ex.target_reps as number | null,
            targetRpe: ex.target_rpe as number | null,
          }
        })
        return {
          id: dayId,
          blockId: day.block_id as number,
          name: day.name as string,
          dayOfWeek: day.day_of_week as number,
          location: day.location as 'gym' | 'home',
          exercises,
        }
      }),
    )

    return { ...block, days }
  }

  async findActiveForUser(userId: string, asOfDate: string): Promise<BlockWithDays | null> {
    const result = await this.db.execute({
      sql: `SELECT id FROM blocks
            WHERE user_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
            ORDER BY start_date DESC LIMIT 1`,
      args: [userId, asOfDate, asOfDate],
    })
    const row = result.rows[0]
    if (!row) return null
    return this.findWithDays((row as unknown as Record<string, unknown>).id as number)
  }
}
