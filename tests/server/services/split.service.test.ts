import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import { SplitService } from '~~/server/services/split.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

describe('SplitService.createFromScratch', () => {
  let db: Client
  let service: SplitService
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    service = new SplitService(ctx, new BlockRepository(db))
  })

  it('creates a block owned by the current user', async () => {
    const block = await service.createFromScratch({
      name: 'My Split',
      startDate: '2026-08-18',
      endDate: null,
      days: [],
    })
    expect(block.userId).toBe('user-1')
  })
})

describe('SplitService.getOwnedBlock', () => {
  let db: Client
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
  })

  it('returns null for a block that does not exist', async () => {
    const service = new SplitService(ctx, new BlockRepository(db))
    expect(await service.getOwnedBlock(999)).toBeNull()
  })

  it('returns the block when the current user owns it', async () => {
    const owner = new SplitService(ctx, new BlockRepository(db))
    const block = await owner.createFromScratch({ name: 'Mine', startDate: '2026-08-18', endDate: null, days: [] })

    const found = await owner.getOwnedBlock(block.id)
    expect(found?.id).toBe(block.id)
  })

  it('throws 403 when the block belongs to a different user', async () => {
    const otherCtx: RequestContext = { userId: 'user-2', roles: [], permissions: [] }
    const owner = new SplitService(ctx, new BlockRepository(db))
    const intruder = new SplitService(otherCtx, new BlockRepository(db))

    const block = await owner.createFromScratch({ name: 'Mine', startDate: '2026-08-18', endDate: null, days: [] })

    await expect(intruder.getOwnedBlock(block.id)).rejects.toThrow(/forbidden/i)
  })
})

describe('SplitService.createFromPreset', () => {
  let db: Client
  let splitService: SplitService
  let presets: PresetSplitRepository
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    presets = new PresetSplitRepository(db)
    splitService = new SplitService(ctx, new BlockRepository(db))
  })

  it('materializes an independent block/days/exercises from a preset', async () => {
    const preset = await presets.createWithDays({
      name: 'PPL', description: null, frequencyMinDays: 6, frequencyMaxDays: 6,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'gym', isPublished: true,
      days: [{
        name: 'Push', dayIndex: 0, location: 'gym', targetMuscleIds: [],
        exercises: [{ exerciseId: 'bench-press', position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 }],
      }],
    })
    const presetWithDays = await presets.findWithDays(preset.id)

    const block = await splitService.createFromPreset(presetWithDays!, {
      name: 'My PPL', startDate: '2026-08-18', endDate: null,
    })

    const cloned = await splitService.getOwnedBlock(block.id)
    expect(cloned?.days[0]?.exercises[0]?.exerciseId).toBe('bench-press')
    expect(cloned?.userId).toBe('user-1')

    await db.execute({ sql: 'UPDATE preset_split_exercises SET target_reps = 999 WHERE preset_split_day_id = (SELECT id FROM preset_split_days WHERE preset_split_id = ?)', args: [preset.id] })
    const stillCloned = await splitService.getOwnedBlock(block.id)
    expect(stillCloned?.days[0]?.exercises[0]?.targetReps).toBe(8)
  })
})
