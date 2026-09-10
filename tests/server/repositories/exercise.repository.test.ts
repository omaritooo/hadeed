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

  it('surfaces tier and movementPattern on findById', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions, movement_pattern, tier)
            VALUES ('squat', 'Barbell Squat', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]', 'knee_dominant', 1)`,
    })
    const found = await repo.findById('squat')
    expect(found?.tier).toBe(1)
    expect(found?.movementPattern).toBe('knee_dominant')
  })

  it('surfaces null tier/movementPattern for unclassified exercises', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('plank', 'Plank', 'strength', null, 'static', 'beginner', 'isolation', '[]')`,
    })
    const found = await repo.findById('plank')
    expect(found?.tier).toBeNull()
    expect(found?.movementPattern).toBeNull()
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

  it('batches muscle/image attachment across multiple exercises from findByIds', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await seedExercise(db, 'bench-press', chest.id)
    await seedExercise(db, 'incline-press', chest.id)
    await db.execute({
      sql: 'INSERT INTO exercise_images (exercise_id, url, position) VALUES (?, ?, ?)',
      args: ['incline-press', 'incline.jpg', 0],
    })

    const results = await repo.findByIds(['bench-press', 'incline-press'])

    expect(results.map(e => e.id).sort()).toEqual(['bench-press', 'incline-press'])
    const inclinePress = results.find(e => e.id === 'incline-press')
    expect(inclinePress?.images).toEqual(['incline.jpg'])
    expect(inclinePress?.primaryMuscles).toEqual(['chest'])
  })

  it('findByIds returns an empty array for an empty id list', async () => {
    const results = await repo.findByIds([])
    expect(results).toEqual([])
  })

  it('searches exercises by a case-insensitive name substring', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Barbell Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('squat', 'Barbell Squat', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })

    const results = await repo.search('bench')
    expect(results.map(e => e.id)).toEqual(['bench-press'])

    const caseInsensitive = await repo.search('BARBELL')
    expect(caseInsensitive.map(e => e.id).sort()).toEqual(['bench-press', 'squat'])
  })

  it('search results are ordered by name and respect the limit', async () => {
    for (const name of ['Zercise C', 'Zercise A', 'Zercise B']) {
      await db.execute({
        sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
              VALUES (?, ?, 'strength', null, 'push', 'beginner', 'compound', '[]')`,
        args: [name, name],
      })
    }

    const results = await repo.search('zercise', 2)
    expect(results.map(e => e.name)).toEqual(['Zercise A', 'Zercise B'])
  })

  it('search returns an empty array for an empty query', async () => {
    expect(await repo.search('')).toEqual([])
  })

  it('trims the query before matching, so trailing whitespace does not break results', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    const results = await repo.search('bench press ')
    expect(results.map(e => e.id)).toEqual(['bench-press'])
  })

  it('finds an exercise by an alias the catalog does not use as a name', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('butterfly', 'Butterfly', 'strength', 'machine', 'push', 'beginner', 'isolation', '[]')`,
    })
    await db.execute({
      sql: `INSERT INTO exercise_aliases (alias, exercise_id) VALUES ('Pec Deck', 'butterfly')`,
    })

    expect((await repo.search('pec deck')).map(e => e.id)).toEqual(['butterfly'])
    expect((await repo.search('Butterfly')).map(e => e.id)).toEqual(['butterfly'])
  })

  it('returns an alias match once, not twice, when the term also hits the name', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('row', 'Seated Cable Rows', 'strength', 'cable', 'pull', 'beginner', 'compound', '[]')`,
    })
    await db.execute({
      sql: `INSERT INTO exercise_aliases (alias, exercise_id) VALUES ('Seated Cable Row', 'row')`,
    })

    expect((await repo.search('seated cable row')).map(e => e.id)).toEqual(['row'])
  })

  it('ranks an exact alias hit above an incidental substring match', async () => {
    // 'RDL' is a substring of 'hurdle', which sorts first alphabetically.
    for (const [id, name] of [['hurdle-hops', 'Hurdle Hops'], ['rdl', 'Romanian Deadlift']]) {
      await db.execute({
        sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
              VALUES (?, ?, 'strength', 'barbell', 'pull', 'beginner', 'compound', '[]')`,
        args: [id!, name!],
      })
    }
    await db.execute({
      sql: `INSERT INTO exercise_aliases (alias, exercise_id) VALUES ('RDL', 'rdl')`,
    })

    expect((await repo.search('RDL')).map(e => e.id)).toEqual(['rdl', 'hurdle-hops'])
  })

  it('surfaces muscles for an exercise found by alias, and tolerates it having no images', async () => {
    const muscles = new MuscleRepository(db)
    const quads = await muscles.getOrCreate('quadriceps')
    await seedExercise(db, 'Pendulum_Squat', quads.id)
    await db.execute({
      sql: `INSERT INTO exercise_aliases (alias, exercise_id) VALUES ('Pendulum Machine', 'Pendulum_Squat')`,
    })

    const [found] = await repo.search('pendulum machine')
    expect(found?.primaryMuscles).toEqual(['quadriceps'])
    expect(found?.images).toEqual([])
  })

  it('finds fallback exercises sharing movement pattern and primary muscle', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')

    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('bb-bench', 'Barbell Bench Press', 'barbell', 'compound', 'horizontal_push', 1)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('db-bench', 'Dumbbell Bench Press', 'dumbbell', 'compound', 'horizontal_push', 1)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('pushup', 'Push-Up', 'body only', 'compound', 'horizontal_push', 1)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('leg-press', 'Leg Press', 'machine', 'compound', 'knee_dominant', 2)` })
    for (const id of ['bb-bench', 'db-bench', 'pushup', 'leg-press']) {
      await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: [id, chest.id, 'primary'] })
    }

    const fallbacks = await repo.findFallbacks('bb-bench', ['dumbbell', 'body only'])
    expect(fallbacks.map(e => e.id).sort()).toEqual(['db-bench', 'pushup'])
  })

  it('excludes the source exercise itself and orders by tier proximity then name', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('src', 'Source', 'barbell', 'compound', 'horizontal_push', 1)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('t3', 'Zzz Isolation', 'cable', 'isolation', 'horizontal_push', 3)` })
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('t1', 'Aaa Compound', 'body only', 'compound', 'horizontal_push', 1)` })
    for (const id of ['src', 't3', 't1']) {
      await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: [id, chest.id, 'primary'] })
    }

    const fallbacks = await repo.findFallbacks('src', ['cable', 'body only'])
    expect(fallbacks.map(e => e.id)).toEqual(['t1', 't3']) // t1 (tier 1, closest) before t3 (tier 3)
  })

  it('findFallbacks returns an empty array for an unknown exerciseId', async () => {
    const fallbacks = await repo.findFallbacks('does-not-exist', ['barbell'])
    expect(fallbacks).toEqual([])
  })

  it('findFallbacks returns an empty array when the source has no movement_pattern', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, tier) VALUES ('no-pattern', 'No Pattern', 'barbell', 'compound', 1)` })
    await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: ['no-pattern', chest.id, 'primary'] })

    const fallbacks = await repo.findFallbacks('no-pattern', ['dumbbell'])
    expect(fallbacks).toEqual([])
  })

  it('findFallbacks returns an empty array when the source has no primary muscle row', async () => {
    const muscles = new MuscleRepository(db)
    const back = await muscles.getOrCreate('back')
    await db.execute({ sql: `INSERT INTO exercises (id, name, equipment, mechanic, movement_pattern, tier) VALUES ('no-primary', 'No Primary', 'barbell', 'compound', 'horizontal_push', 1)` })
    // only a secondary muscle row, no primary
    await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: ['no-primary', back.id, 'secondary'] })

    const fallbacks = await repo.findFallbacks('no-primary', ['dumbbell'])
    expect(fallbacks).toEqual([])
  })
})
