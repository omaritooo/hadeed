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
      equipment: 'gym',
      isPublished: true,
      days: [
        {
          name: 'Push',
          dayIndex: 0,
          location: 'gym',
          targetMuscleIds: [chest.id],
          exercises: [{ exerciseId: 'bench-press', position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 }],
        },
      ],
    })

    const full = await repo.findWithDays(preset.id)
    expect(full?.days).toHaveLength(1)
    expect(full?.days[0]?.targetMuscleIds).toEqual([chest.id])
    expect(full?.days[0]?.exercises[0]?.exerciseId).toBe('bench-press')
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
})
