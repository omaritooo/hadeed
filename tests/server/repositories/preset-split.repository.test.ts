import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { MuscleRepository } from '~~/server/repositories/muscle.repository'
import { PresetSplitRepository } from '~~/server/repositories/preset-split.repository'

describe('PresetSplitRepository', () => {
  let db: Client
  let repo: PresetSplitRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    repo = new PresetSplitRepository(db)
  })

  it('creates a preset with nested days, target muscles, and recommended exercises', async () => {
    const chest = await new MuscleRepository(db).getOrCreate('chest')

    const preset = await repo.createWithDays({
      name: 'Push Pull Legs',
      description: 'Classic 6-day PPL',
      frequencyMinDays: 5,
      frequencyMaxDays: 6,
      goal: 'muscle_gain',
      experienceLevel: 'intermediate',
      equipment: 'full_gym',
      isPublished: true,
      days: [
        {
          name: 'Push',
          dayIndex: 0,
          location: 'gym',
          targetMuscleIds: [chest.id],
          exercises: [{ exerciseId: 'bench-press', position: 0, targetSets: 4, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 8 }],
        },
      ],
    })

    const full = await repo.findWithDays(preset.id)
    expect(full?.days).toHaveLength(1)
    expect(full?.days[0]?.targetMuscleIds).toEqual([chest.id])
    expect(full?.days[0]?.exercises[0]?.exerciseId).toBe('bench-press')
  })

  it('creates a circuit day with rounds and a per-exercise rest_seconds', async () => {
    const chest = await new MuscleRepository(db).getOrCreate('chest')

    const preset = await repo.createWithDays({
      name: 'Push Pull Legs',
      description: 'Classic 6-day PPL',
      frequencyMinDays: 5,
      frequencyMaxDays: 6,
      goal: 'muscle_gain',
      experienceLevel: 'intermediate',
      equipment: 'full_gym',
      isPublished: true,
      days: [
        {
          name: 'Push',
          dayIndex: 0,
          location: 'gym',
          format: 'circuit',
          rounds: 4,
          targetMuscleIds: [chest.id],
          exercises: [{ exerciseId: 'bench-press', position: 0, targetSets: 4, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 8, restSeconds: 30 }],
        },
      ],
    })

    const full = await repo.findWithDays(preset.id)
    expect(full?.days[0]?.format).toBe('circuit')
    expect(full?.days[0]?.rounds).toBe(4)
    expect(full?.days[0]?.exercises[0]?.restSeconds).toBe(30)
  })

  it('defaults format to straight_sets, rounds to 1, and rest_seconds to null when not specified', async () => {
    const chest = await new MuscleRepository(db).getOrCreate('chest')

    const preset = await repo.createWithDays({
      name: 'Push Pull Legs',
      description: 'Classic 6-day PPL',
      frequencyMinDays: 5,
      frequencyMaxDays: 6,
      goal: 'muscle_gain',
      experienceLevel: 'intermediate',
      equipment: 'full_gym',
      isPublished: true,
      days: [
        {
          name: 'Push',
          dayIndex: 0,
          location: 'gym',
          targetMuscleIds: [chest.id],
          exercises: [{ exerciseId: 'bench-press', position: 0, targetSets: 4, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 8 }],
        },
      ],
    })

    const full = await repo.findWithDays(preset.id)
    expect(full?.days[0]?.format).toBe('straight_sets')
    expect(full?.days[0]?.rounds).toBe(1)
    expect(full?.days[0]?.exercises[0]?.restSeconds).toBeNull()
  })

  it('findPublished only returns published presets', async () => {
    await repo.createWithDays({
      name: 'Draft', description: null, frequencyMinDays: 3, frequencyMaxDays: 3,
      goal: null, experienceLevel: null, equipment: 'both', isPublished: false, days: [],
    })
    await repo.createWithDays({
      name: 'Live', description: null, frequencyMinDays: 3, frequencyMaxDays: 3,
      goal: null, experienceLevel: null, equipment: 'both', isPublished: true, days: [],
    })

    const published = await repo.findPublished()
    expect(published.map(p => p.name)).toEqual(['Live'])
  })

  it('dual-writes target_reps as the range minimum and reads a row that only has target_reps set', async () => {
    const preset = await repo.createWithDays({
      name: 'Range', description: null, frequencyMinDays: 3, frequencyMaxDays: 3,
      goal: null, experienceLevel: null, equipment: 'both', isPublished: true,
      days: [{
        name: 'Push', dayIndex: 0, location: 'gym', targetMuscleIds: [],
        exercises: [{ exerciseId: 'bench-press', position: 0, targetSets: 4, targetRepsMin: 8, targetRepsMax: 10, targetRpe: 8 }],
      }],
    })

    const row = (await db.execute('SELECT target_reps, target_reps_min, target_reps_max FROM preset_split_exercises')).rows[0]!
    expect([row.target_reps, row.target_reps_min, row.target_reps_max]).toEqual([8, 8, 10])

    await db.execute('UPDATE preset_split_exercises SET target_reps = 6, target_reps_min = NULL, target_reps_max = NULL')
    const exercise = (await repo.findWithDays(preset.id))?.days[0]?.exercises[0]
    expect(exercise?.targetRepsMin).toBe(6)
    expect(exercise?.targetRepsMax).toBe(6)
    expect(exercise?.targetReps).toBe(6)
  })
})
