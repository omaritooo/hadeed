import { BaseRepository } from '~~/server/repositories/base.repository'
import type { Exercise } from '~~/shared/types/exercise.types'
import type { JointArea } from '~~/shared/lib/joint-areas'
import { JOINT_AREAS } from '~~/shared/lib/joint-areas'

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
      tier: row.tier as 1 | 2 | 3 | null,
      movementPattern: row.movement_pattern as string | null,
      stressors: [],
    }
  }

  private async attachDetails(exercises: Exercise[]): Promise<Exercise[]> {
    if (exercises.length === 0) return exercises

    const ids = exercises.map(e => e.id)
    const placeholders = ids.map(() => '?').join(', ')

    const [musclesResult, imagesResult, stressorsResult] = await Promise.all([
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
      this.db.execute({
        sql: `SELECT exercise_id, area FROM exercise_stressors WHERE exercise_id IN (${placeholders})`,
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

    const stressorsByExercise = new Map<string, string[]>()
    for (const row of stressorsResult.rows) {
      const exerciseId = row.exercise_id as string
      const list = stressorsByExercise.get(exerciseId) ?? []
      list.push(row.area as string)
      stressorsByExercise.set(exerciseId, list)
    }

    for (const exercise of exercises) {
      const stressors = stressorsByExercise.get(exercise.id) ?? []
      exercise.stressors = JOINT_AREAS.filter(area => stressors.includes(area))
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

  async findByIds(ids: string[]): Promise<Exercise[]> {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(', ')
    const result = await this.db.execute({
      sql: `SELECT * FROM exercises WHERE id IN (${placeholders})`,
      args: ids,
    })
    const exercises = result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
    return this.attachDetails(exercises)
  }

  // `avoid` only reorders: candidates stressing any of those areas sink below the rest but are
  // still returned, so a user with a flagged joint keeps every option and just sees safer ones first.
  async findFallbacks(exerciseId: string, equipmentTiers: string[], avoid: JointArea[] = []): Promise<Exercise[]> {
    if (equipmentTiers.length === 0) return []

    // exercise_muscles doesn't enforce at most one 'primary' row per exercise; if that ever happens,
    // deterministically pick the lowest muscle_id rather than relying on arbitrary row order.
    const sourceResult = await this.db.execute({
      sql: `SELECT e.movement_pattern, e.tier, em.muscle_id
            FROM exercises e
            LEFT JOIN exercise_muscles em ON em.exercise_id = e.id AND em.role = 'primary'
            WHERE e.id = ?
            ORDER BY em.muscle_id
            LIMIT 1`,
      args: [exerciseId],
    })
    const sourceRow = sourceResult.rows[0] as unknown as Record<string, unknown> | undefined
    if (!sourceRow || !sourceRow.movement_pattern || sourceRow.muscle_id == null) return []

    const movementPattern = sourceRow.movement_pattern as string
    const primaryMuscleId = sourceRow.muscle_id as number
    const tier = sourceRow.tier as number | null

    const placeholders = equipmentTiers.map(() => '?').join(', ')
    // Skip the stressor term entirely when nothing is avoided, since `IN ()` is invalid SQL.
    const avoidOrder = avoid.length > 0
      ? `(SELECT COUNT(*) FROM exercise_stressors s WHERE s.exercise_id = e2.id AND s.area IN (${avoid.map(() => '?').join(', ')})) > 0, `
      : ''
    const result = await this.db.execute({
      sql: `SELECT e2.* FROM exercises e2
            JOIN exercise_muscles em2 ON em2.exercise_id = e2.id AND em2.role = 'primary'
            WHERE e2.movement_pattern = ?
              AND em2.muscle_id = ?
              AND e2.equipment IN (${placeholders})
              AND e2.id != ?
            ORDER BY ${avoidOrder}ABS(COALESCE(e2.tier, 2) - ?), e2.name`,
      args: [movementPattern, primaryMuscleId, ...equipmentTiers, exerciseId, ...avoid, tier ?? 2],
    })
    const exercises = result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
    return this.attachDetails(exercises)
  }

  // Matches aliases as well as names, because the catalog names a lot of common
  // movements in ways nobody types — a pec deck is stored as "Butterfly", an
  // overhead press as "Standing Military Press" — and has no plain "Bench
  // Press"/"Squat"/"Deadlift" row at all, only qualified variants. The subquery
  // keeps one row per exercise even when the term hits both a name and an alias.
  async search(query: string, limit = 30): Promise<Exercise[]> {
    const trimmed = query.trim()
    if (trimmed === '') return []
    const pattern = `%${trimmed}%`
    // Ranked rather than ordered purely by name, because a short alias would
    // otherwise be buried by incidental substring hits — "RDL" matches
    // "hu(rdl)e hops", which sorts above "Romanian Deadlift" alphabetically.
    // Exact name, then exact alias, then prefix, then any remaining substring.
    const result = await this.db.execute({
      sql: `SELECT * FROM exercises
            WHERE name LIKE ?
               OR id IN (SELECT exercise_id FROM exercise_aliases WHERE alias LIKE ?)
            ORDER BY
              CASE
                WHEN name = ? COLLATE NOCASE THEN 0
                WHEN id IN (SELECT exercise_id FROM exercise_aliases WHERE alias = ?) THEN 1
                WHEN name LIKE ? THEN 2
                ELSE 3
              END,
              name
            LIMIT ?`,
      args: [pattern, pattern, trimmed, trimmed, `${trimmed}%`, limit],
    })
    const exercises = result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
    return this.attachDetails(exercises)
  }

}
