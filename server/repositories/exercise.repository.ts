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
      primaryMuscles: [],
      secondaryMuscles: [],
      images: [],
    }
  }

  private async attachDetails(exercises: Exercise[]): Promise<Exercise[]> {
    if (exercises.length === 0) return exercises

    const ids = exercises.map(e => e.id)
    const placeholders = ids.map(() => '?').join(', ')

    const [musclesResult, imagesResult] = await Promise.all([
      this.db.execute({
        sql: `SELECT exercise_muscles.exercise_id AS exercise_id,
                     exercise_muscles.role AS role,
                     muscles.name AS name
              FROM exercise_muscles
              JOIN muscles ON muscles.id = exercise_muscles.muscle_id
              WHERE exercise_muscles.exercise_id IN (${placeholders})`,
        args: ids,
      }),
      this.db.execute({
        sql: `SELECT exercise_id, url
              FROM exercise_images
              WHERE exercise_id IN (${placeholders})
              ORDER BY exercise_id, position`,
        args: ids,
      }),
    ])

    const primaryByExercise = new Map<string, string[]>()
    const secondaryByExercise = new Map<string, string[]>()
    for (const row of musclesResult.rows) {
      const exerciseId = row.exercise_id as string
      const bucket = row.role === 'primary' ? primaryByExercise : secondaryByExercise
      const list = bucket.get(exerciseId) ?? []
      list.push(row.name as string)
      bucket.set(exerciseId, list)
    }

    const imagesByExercise = new Map<string, string[]>()
    for (const row of imagesResult.rows) {
      const exerciseId = row.exercise_id as string
      const list = imagesByExercise.get(exerciseId) ?? []
      list.push(row.url as string)
      imagesByExercise.set(exerciseId, list)
    }

    for (const exercise of exercises) {
      exercise.primaryMuscles = primaryByExercise.get(exercise.id) ?? []
      exercise.secondaryMuscles = secondaryByExercise.get(exercise.id) ?? []
      exercise.images = imagesByExercise.get(exercise.id) ?? []
    }

    return exercises
  }

  override async findById(id: string | number): Promise<Exercise | null> {
    const exercise = await super.findById(id)
    if (!exercise) return null
    const [attached] = await this.attachDetails([exercise])
    return attached ?? null
  }

  override async findMany(where: Record<string, string | number> = {}): Promise<Exercise[]> {
    const exercises = await super.findMany(where)
    return this.attachDetails(exercises)
  }

  override async insert(data: Record<string, unknown>): Promise<Exercise> {
    const exercise = await super.insert(data)
    const [attached] = await this.attachDetails([exercise])
    return attached ?? exercise
  }

  override async update(id: string | number, data: Record<string, unknown>): Promise<Exercise | null> {
    const exercise = await super.update(id, data)
    if (!exercise) return null
    const [attached] = await this.attachDetails([exercise])
    return attached ?? null
  }

  async findByMuscle(muscleId: number): Promise<Exercise[]> {
    const result = await this.db.execute({
      sql: `SELECT exercises.* FROM exercises
            JOIN exercise_muscles ON exercise_muscles.exercise_id = exercises.id
            WHERE exercise_muscles.muscle_id = ?
            GROUP BY exercises.id`,
      args: [muscleId],
    })
    const exercises = result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
    return this.attachDetails(exercises)
  }
}
