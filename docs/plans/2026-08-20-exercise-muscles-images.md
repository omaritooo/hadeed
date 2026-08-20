# Exercise Muscles & Images Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every `Exercise` returned by `ExerciseRepository` include `primaryMuscles`, `secondaryMuscles`, and `images`, which are already populated in the database but currently dropped.

**Architecture:** Add the three fields to the `Exercise` type. `mapRow` stays row-only (no joins); a new private `attachDetails` batch-enriches an array of already-mapped exercises with two `IN (...)`-scoped queries (muscles, images), grouped and merged by `exercise_id`. Every `ExerciseRepository` method that returns `Exercise`/`Exercise[]` (`findById`, `findMany`, `findByMuscle`, `insert`, `update`) routes through it.

**Tech Stack:** Nuxt/Nitro server, `@libsql/client`, Vitest. See `docs/plans/2026-08-20-exercise-muscles-images-design.md` for the approved design.

---

### Task 1: Extend the `Exercise` type

**Files:**
- Modify: `shared/types/exercise.types.ts:8-17`

**Step 1: Update the interface**

```ts
export interface Exercise {
  id: string
  name: string
  category: string | null
  equipment: string | null
  force: string | null
  level: string | null
  mechanic: string | null
  instructions: string[]
  primaryMuscles: string[]
  secondaryMuscles: string[]
  images: string[]
}
```

**Step 2: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: Errors in `server/repositories/exercise.repository.ts` (object literal missing the three new fields) — this is expected at this point, it's the "failing test" for a type-level change. No errors anywhere else (confirmed no other file constructs an `Exercise` object literal).

**Step 3: Commit**

```bash
git add shared/types/exercise.types.ts
git commit -m "feat: add primaryMuscles/secondaryMuscles/images to Exercise type"
```

---

### Task 2: Write failing repository tests

**Files:**
- Modify: `tests/server/repositories/exercise.repository.test.ts`

**Step 1: Extend the `seedExercise` helper to also insert an image, and add new assertions**

Replace the file contents with:

```ts
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
```

**Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/server/repositories/exercise.repository.test.ts`
Expected: The 3 new tests FAIL (actual `primaryMuscles`/`secondaryMuscles`/`images` are `undefined`, not the expected arrays). The 2 original tests still PASS.

**Step 3: Commit**

```bash
git add tests/server/repositories/exercise.repository.test.ts
git commit -m "test: cover exercise muscle/image attachment"
```

---

### Task 3: Implement `attachDetails` and route all read/write methods through it

**Files:**
- Modify: `server/repositories/exercise.repository.ts`

**Step 1: Replace the file contents**

```ts
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

  async findById(id: string | number): Promise<Exercise | null> {
    const exercise = await super.findById(id)
    if (!exercise) return null
    const [attached] = await this.attachDetails([exercise])
    return attached
  }

  async findMany(where: Record<string, string | number> = {}): Promise<Exercise[]> {
    const exercises = await super.findMany(where)
    return this.attachDetails(exercises)
  }

  async insert(data: Record<string, unknown>): Promise<Exercise> {
    const exercise = await super.insert(data)
    const [attached] = await this.attachDetails([exercise])
    return attached
  }

  async update(id: string | number, data: Record<string, unknown>): Promise<Exercise | null> {
    const exercise = await super.update(id, data)
    if (!exercise) return null
    const [attached] = await this.attachDetails([exercise])
    return attached
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
```

**Step 2: Run the repository tests to verify they pass**

Run: `npx vitest run tests/server/repositories/exercise.repository.test.ts`
Expected: All 5 tests PASS.

**Step 3: Type-check the whole project**

Run: `npx vue-tsc --noEmit`
Expected: No errors (the Task 1 error about the object literal is now resolved).

**Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS (no regressions in other repositories).

**Step 5: Commit**

```bash
git add server/repositories/exercise.repository.ts
git commit -m "feat: attach muscles/images to every exercise read/write"
```

---

### Task 4: Manual smoke check

**Step 1: Start the dev server**

Run: `npm run dev`

**Step 2: Hit the detail endpoint for a seeded exercise**

Run: `curl -s http://localhost:3000/api/exercises/Barbell_Squat | jq '{primaryMuscles, secondaryMuscles, images}'`
Expected: Non-empty `primaryMuscles` array (`["quadriceps", ...]` or similar), and `images` populated if `gym_exercises.json` has images for that exercise. (Note: this requires the dev DB to already be seeded via `server/database/seed.ts` — if it's a fresh Turso DB, run the seed script first.)

**Step 3: Stop the dev server**
