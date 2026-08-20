import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { MuscleRepository } from '~~/server/repositories/muscle.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'

async function seedExercise(db: Client, id: string, muscleId: number) {
  await db.execute({
    sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
          VALUES (?, ?, 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    args: [id, id],
  })
  await db.execute({
    sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)',
    args: [id, muscleId, 'primary'],
  })
}

describe('ExerciseRepository', () => {
  let db: Client
  let repo: ExerciseRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new ExerciseRepository(db)
  })

  it('finds an exercise by id and parses instructions JSON', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '["Lie down", "Press up"]')`,
    })
    const found = await repo.findById('bench-press')
    expect(found?.instructions).toEqual(['Lie down', 'Press up'])
  })

  it('finds exercises that target a given muscle', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    const back = await muscles.getOrCreate('back')
    await seedExercise(db, 'bench-press', chest.id)
    await seedExercise(db, 'row', back.id)

    const results = await repo.findByMuscle(chest.id)
    expect(results.map(e => e.id)).toEqual(['bench-press'])
  })

  it('attaches primary/secondary muscles and ordered images on findById', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    const triceps = await muscles.getOrCreate('triceps')

    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    await db.execute({
      sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)',
      args: ['bench-press', chest.id, 'primary'],
    })
    await db.execute({
      sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)',
      args: ['bench-press', triceps.id, 'secondary'],
    })
    await db.execute({
      sql: 'INSERT INTO exercise_images (exercise_id, url, position) VALUES (?, ?, ?)',
      args: ['bench-press', 'second.jpg', 1],
    })
    await db.execute({
      sql: 'INSERT INTO exercise_images (exercise_id, url, position) VALUES (?, ?, ?)',
      args: ['bench-press', 'first.jpg', 0],
    })

    const found = await repo.findById('bench-press')
    expect(found?.primaryMuscles).toEqual(['chest'])
    expect(found?.secondaryMuscles).toEqual(['triceps'])
    expect(found?.images).toEqual(['first.jpg', 'second.jpg'])
  })

  it('returns empty arrays when an exercise has no muscles or images', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('plank', 'Plank', 'strength', null, 'static', 'beginner', 'isolation', '[]')`,
    })
    const found = await repo.findById('plank')
    expect(found?.primaryMuscles).toEqual([])
    expect(found?.secondaryMuscles).toEqual([])
    expect(found?.images).toEqual([])
  })

  it('batches muscle/image attachment across multiple exercises from findByMuscle', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await seedExercise(db, 'bench-press', chest.id)
    await seedExercise(db, 'incline-press', chest.id)
    await db.execute({
      sql: 'INSERT INTO exercise_images (exercise_id, url, position) VALUES (?, ?, ?)',
      args: ['incline-press', 'incline.jpg', 0],
    })

    const results = await repo.findByMuscle(chest.id)
    const inclinePress = results.find(e => e.id === 'incline-press')
    const benchPress = results.find(e => e.id === 'bench-press')
    expect(inclinePress?.images).toEqual(['incline.jpg'])
    expect(inclinePress?.primaryMuscles).toEqual(['chest'])
    expect(benchPress?.images).toEqual([])
  })
})
