import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { BlockRepository } from '~~/server/repositories/block.repository'

describe('BlockRepository', () => {
  let db: Client
  let repo: BlockRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    repo = new BlockRepository(db)
  })

  it('creates a block with nested split days and exercises in one call', async () => {
    const block = await repo.createWithDays('user-1', {
      programId: null,
      name: 'Push Pull Legs',
      startDate: '2026-08-18',
      endDate: null,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: [
        {
          name: 'Push',
          dayOfWeek: 1,
          location: 'gym',
          exercises: [{ exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 4, targetReps: 8, targetRpe: 8 }],
        },
      ],
    })

    const full = await repo.findWithDays(block.id)
    expect(full?.days).toHaveLength(1)
    expect(full?.days[0]?.exercises).toHaveLength(1)
    expect(full?.days[0]?.exercises[0]?.exerciseId).toBe('bench-press')
  })

  it('creates an implicit program when programId is not provided', async () => {
    const block = await repo.createWithDays('user-1', {
      programId: null,
      name: 'Solo Block',
      startDate: '2026-08-18',
      endDate: null,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: [],
    })
    const program = await db.execute({ sql: 'SELECT * FROM programs WHERE id = ?', args: [block.programId] })
    expect(program.rows).toHaveLength(1)
  })
})

describe('BlockRepository.findActiveForUser', () => {
  it('finds the block whose date range covers today', async () => {
    const db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const repo = new BlockRepository(db)

    const past = await repo.createWithDays('user-1', {
      programId: null, name: 'Old Block', startDate: '2020-01-01', endDate: '2020-02-01',
      trainingDayMacroTarget: null, restDayMacroTarget: null, days: [],
    })
    const active = await repo.createWithDays('user-1', {
      programId: null, name: 'Current Block', startDate: '2020-01-01', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null, days: [],
    })

    const found = await repo.findActiveForUser('user-1', '2026-08-21')
    expect(found?.id).toBe(active.id)
    expect(found?.id).not.toBe(past.id)
  })

  it('returns null when no block covers today', async () => {
    const db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const repo = new BlockRepository(db)
    expect(await repo.findActiveForUser('user-1', '2026-08-21')).toBeNull()
  })
})
