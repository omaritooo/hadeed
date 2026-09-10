import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { upsertExercises, replaceExerciseAliases, type RawExercise } from '~~/server/database/seed-exercises'

const exercise = (overrides: Partial<RawExercise> = {}): RawExercise => ({
  id: 'squat',
  name: 'Barbell Squat',
  category: 'strength',
  equipment: 'barbell',
  force: 'push',
  level: 'beginner',
  mechanic: 'compound',
  primaryMuscles: ['quadriceps'],
  secondaryMuscles: ['glutes'],
  instructions: ['Unrack the bar.'],
  images: ['start.jpg', 'end.jpg'],
  ...overrides,
})

const classificationOf = async (db: Client, id: string) => {
  const result = await db.execute({
    sql: 'SELECT tier, movement_pattern FROM exercises WHERE id = ?',
    args: [id],
  })
  return result.rows[0]
}

describe('upsertExercises', () => {
  let db: Client

  beforeEach(async () => {
    db = await createTestDb()
  })

  // Regression: the seed previously used INSERT OR REPLACE, which deletes the
  // conflicting row and inserts a fresh one. movement_pattern and tier aren't
  // in the column list (classify-exercises.ts owns them), so every re-seed
  // silently nulled the classification for the entire catalog — and nothing
  // failed, exercise swapping just stopped returning results.
  it('preserves tier and movementPattern written by the classifier', async () => {
    await upsertExercises(db, [exercise()])
    await db.execute(`UPDATE exercises SET tier = 1, movement_pattern = 'knee_dominant' WHERE id = 'squat'`)

    await upsertExercises(db, [exercise()])

    expect(await classificationOf(db, 'squat')).toMatchObject({ tier: 1, movement_pattern: 'knee_dominant' })
  })

  it('still applies changed columns on a re-seed', async () => {
    await upsertExercises(db, [exercise()])
    await db.execute(`UPDATE exercises SET tier = 1, movement_pattern = 'knee_dominant' WHERE id = 'squat'`)

    await upsertExercises(db, [exercise({ name: 'Barbell Back Squat', level: 'intermediate' })])

    const result = await db.execute(`SELECT name, level, tier FROM exercises WHERE id = 'squat'`)
    // The point of the upsert is that data edits land *and* classification survives.
    expect(result.rows[0]).toMatchObject({ name: 'Barbell Back Squat', level: 'intermediate', tier: 1 })
  })

  it('replaces muscles and images rather than accumulating duplicates', async () => {
    await upsertExercises(db, [exercise()])
    await upsertExercises(db, [exercise({ primaryMuscles: ['hamstrings'], secondaryMuscles: [], images: ['only.jpg'] })])

    const muscles = await db.execute(`
      SELECT muscles.name, exercise_muscles.role FROM exercise_muscles
      JOIN muscles ON muscles.id = exercise_muscles.muscle_id
      WHERE exercise_id = 'squat'`)
    const images = await db.execute(`SELECT url FROM exercise_images WHERE exercise_id = 'squat' ORDER BY position`)

    expect(muscles.rows).toHaveLength(1)
    expect(muscles.rows[0]).toMatchObject({ name: 'hamstrings', role: 'primary' })
    expect(images.rows.map(r => r.url)).toEqual(['only.jpg'])
  })

  it('stores an exercise with no images, which every gap-fill entry relies on', async () => {
    await upsertExercises(db, [exercise({ id: 'pendulum', images: [] })])

    const images = await db.execute(`SELECT url FROM exercise_images WHERE exercise_id = 'pendulum'`)
    expect(images.rows).toEqual([])
  })
})

describe('replaceExerciseAliases', () => {
  let db: Client

  beforeEach(async () => {
    db = await createTestDb()
    await upsertExercises(db, [exercise()])
  })

  it('drops aliases that are no longer in the input', async () => {
    await replaceExerciseAliases(db, [
      { alias: 'Squat', exerciseId: 'squat' },
      { alias: 'Typo Alias', exerciseId: 'squat' },
    ])
    await replaceExerciseAliases(db, [{ alias: 'Squat', exerciseId: 'squat' }])

    const result = await db.execute('SELECT alias FROM exercise_aliases')
    expect(result.rows.map(r => r.alias)).toEqual(['Squat'])
  })

  it('matches an alias case-insensitively', async () => {
    await replaceExerciseAliases(db, [{ alias: 'Back Squat', exerciseId: 'squat' }])

    const result = await db.execute({
      sql: 'SELECT exercise_id FROM exercise_aliases WHERE alias = ?',
      args: ['bAcK sQuAt'],
    })
    expect(result.rows[0]).toMatchObject({ exercise_id: 'squat' })
  })
})
