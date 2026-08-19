import { BaseRepository } from '~~/server/repositories/base.repository'
import type { Exercise } from '~~/shared/types/exercise.types'

export class ExerciseRepository extends BaseRepository<Exercise> {
  protected tableName = 'exercises'

  protected mapRow(row: Record<string, unknown>): Exercise {
    return {
      id: row.id as string,
      name: row.name as string,
      category: row.category as string | null,
      equipment: row.equipment as string | null,
      force: row.force as string | null,
      level: row.level as string | null,
      mechanic: row.mechanic as string | null,
      instructions: JSON.parse((row.instructions as string) ?? '[]'),
    }
  }

  async findByMuscle(muscleId: number): Promise<Exercise[]> {
    const result = await this.db.execute({
      sql: `SELECT exercises.* FROM exercises
            JOIN exercise_muscles ON exercise_muscles.exercise_id = exercises.id
            WHERE exercise_muscles.muscle_id = ?
            GROUP BY exercises.id`,
      args: [muscleId],
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }
}
