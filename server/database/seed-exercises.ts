import type { Client } from '@libsql/client'

export interface RawExercise {
  id: string
  name: string
  category: string | null
  equipment: string | null
  force: string | null
  level: string | null
  mechanic: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  instructions: string[]
  images: string[]
}

export interface RawExerciseAlias {
  alias: string
  exerciseId: string
}

// Muscle names repeat constantly across the catalog (18 distinct values over
// ~1000 exercises), so resolve each one to its id once per pass.
const createMuscleIdResolver = (db: Client) => {
  const cache = new Map<string, number>()
  return async (name: string): Promise<number> => {
    const cached = cache.get(name)
    if (cached) return cached
    await db.execute({ sql: 'INSERT OR IGNORE INTO muscles (name) VALUES (?)', args: [name] })
    const result = await db.execute({ sql: 'SELECT id FROM muscles WHERE name = ?', args: [name] })
    const id = result.rows[0]!.id as number
    cache.set(name, id)
    return id
  }
}

export const upsertExercises = async (db: Client, exercises: RawExercise[]): Promise<void> => {
  const getMuscleId = createMuscleIdResolver(db)

  for (const ex of exercises) {
    // Upsert rather than INSERT OR REPLACE: the latter deletes the conflicting
    // row and inserts a fresh one, so movement_pattern and tier — which this
    // statement doesn't list, because classify-exercises.ts owns them — were
    // reset to NULL for the whole catalog on every re-seed. Updating the named
    // columns leaves the classification in place.
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name         = excluded.name,
              category     = excluded.category,
              equipment    = excluded.equipment,
              force        = excluded.force,
              level        = excluded.level,
              mechanic     = excluded.mechanic,
              instructions = excluded.instructions`,
      args: [
        ex.id,
        ex.name,
        ex.category,
        ex.equipment,
        ex.force,
        ex.level,
        ex.mechanic,
        JSON.stringify(ex.instructions ?? []),
      ],
    })

    await db.execute({ sql: 'DELETE FROM exercise_muscles WHERE exercise_id = ?', args: [ex.id] })
    for (const name of ex.primaryMuscles ?? []) {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)',
        args: [ex.id, await getMuscleId(name), 'primary'],
      })
    }
    for (const name of ex.secondaryMuscles ?? []) {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)',
        args: [ex.id, await getMuscleId(name), 'secondary'],
      })
    }

    await db.execute({ sql: 'DELETE FROM exercise_images WHERE exercise_id = ?', args: [ex.id] })
    for (const [position, url] of (ex.images ?? []).entries()) {
      await db.execute({
        sql: 'INSERT INTO exercise_images (exercise_id, url, position) VALUES (?, ?, ?)',
        args: [ex.id, url, position],
      })
    }
  }
}

// Rebuilt wholesale so aliases dropped from the JSON disappear from the
// database too. Must run after every exercise pass, since each alias
// references a row one of them inserted.
export const replaceExerciseAliases = async (db: Client, aliases: RawExerciseAlias[]): Promise<void> => {
  await db.execute('DELETE FROM exercise_aliases')
  for (const { alias, exerciseId } of aliases) {
    await db.execute({
      sql: 'INSERT INTO exercise_aliases (alias, exercise_id) VALUES (?, ?)',
      args: [alias, exerciseId],
    })
  }
}
