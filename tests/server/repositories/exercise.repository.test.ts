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
})
