import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { BlockRepository, type CreateSplitExerciseInput } from '~~/server/repositories/block.repository'

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
          exercises: [{ exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 4, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 8 }],
        },
      ],
    })

    const full = await repo.findWithDays(block.id)
    expect(full?.days).toHaveLength(1)
    expect(full?.days[0]?.exercises).toHaveLength(1)
    expect(full?.days[0]?.exercises[0]?.exerciseId).toBe('bench-press')
  })

  it('creates a circuit day with rounds and a per-exercise rest_seconds', async () => {
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
          format: 'circuit',
          rounds: 4,
          exercises: [{ exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 4, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 8, restSeconds: 30 }],
        },
      ],
    })

    const full = await repo.findWithDays(block.id)
    expect(full?.days[0]?.format).toBe('circuit')
    expect(full?.days[0]?.rounds).toBe(4)
    expect(full?.days[0]?.exercises[0]?.restSeconds).toBe(30)
  })

  it('defaults format to straight_sets, rounds to 1, and rest_seconds to null when not specified', async () => {
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
          exercises: [{ exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 4, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 8 }],
        },
      ],
    })

    const full = await repo.findWithDays(block.id)
    expect(full?.days[0]?.format).toBe('straight_sets')
    expect(full?.days[0]?.rounds).toBe(1)
    expect(full?.days[0]?.exercises[0]?.restSeconds).toBeNull()
  })

  it('defaults isRestDay to false, and persists an explicit true, on each split day', async () => {
    const block = await repo.createWithDays('user-1', {
      programId: null,
      name: 'Push Pull Legs',
      startDate: '2026-08-18',
      endDate: null,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: [
        { name: 'Push', dayOfWeek: 1, location: 'gym', exercises: [] },
        { name: 'Rest', dayOfWeek: 2, location: 'home', isRestDay: true, exercises: [] },
      ],
    })

    const full = await repo.findWithDays(block.id)
    expect(full?.days[0]?.isRestDay).toBe(false)
    expect(full?.days[1]?.isRestDay).toBe(true)
  })

  it('dual-writes target_reps as the range minimum so older app builds still read a prescription', async () => {
    await repo.createWithDays('user-1', {
      programId: null, name: 'Range', startDate: '2026-08-18', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [{
        name: 'Push', dayOfWeek: 1, location: 'gym',
        exercises: [{ exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 4, targetRepsMin: 8, targetRepsMax: 10, targetRpe: 8 }],
      }],
    })

    const row = (await db.execute('SELECT target_reps, target_reps_min, target_reps_max FROM split_exercises')).rows[0]!
    expect([row.target_reps, row.target_reps_min, row.target_reps_max]).toEqual([8, 8, 10])
  })

  it('reads a row that only has target_reps set, as written by an older app build', async () => {
    const block = await repo.createWithDays('user-1', {
      programId: null, name: 'Legacy', startDate: '2026-08-18', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [{
        name: 'Push', dayOfWeek: 1, location: 'gym',
        exercises: [{ exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 4, targetRepsMin: 8, targetRepsMax: 10, targetRpe: 8 }],
      }],
    })
    await db.execute('UPDATE split_exercises SET target_reps = 6, target_reps_min = NULL, target_reps_max = NULL')

    const exercise = (await repo.findWithDays(block.id))?.days[0]?.exercises[0]
    expect(exercise?.targetRepsMin).toBe(6)
    expect(exercise?.targetRepsMax).toBe(6)
    expect(exercise?.targetReps).toBe(6)
  })

  it('stores the prescription from a legacy payload that sends targetReps and omits nullable fields', async () => {
    // An older PWA build posts a single targetReps and may leave out targetRpe / restSeconds.
    const legacyExercise = { exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 4, targetReps: 8 }
    const block = await repo.createWithDays('user-1', {
      programId: null, name: 'Legacy payload', startDate: '2026-08-18', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [{ name: 'Push', dayOfWeek: 1, location: 'gym', exercises: [legacyExercise as unknown as CreateSplitExerciseInput] }],
    })

    const exercise = (await repo.findWithDays(block.id))?.days[0]?.exercises[0]
    expect(exercise).toMatchObject({ targetSets: 4, targetRepsMin: 8, targetRepsMax: 8, targetRpe: null, restSeconds: null })
    const row = (await db.execute('SELECT target_reps FROM split_exercises')).rows[0]!
    expect(row.target_reps).toBe(8)
  })

  it('keeps an open-ended range open instead of filling the missing end from target_reps', async () => {
    const block = await repo.createWithDays('user-1', {
      programId: null, name: 'Open range', startDate: '2026-08-18', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [{
        name: 'Push', dayOfWeek: 1, location: 'gym',
        exercises: [{ exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 4, targetRepsMin: 8, targetRepsMax: null, targetRpe: 8 }],
      }],
    })

    const exercise = (await repo.findWithDays(block.id))?.days[0]?.exercises[0]
    expect(exercise?.targetRepsMin).toBe(8)
    expect(exercise?.targetRepsMax).toBeNull()
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

  it('breaks ties on identical start_date by returning the more-recently-created block', async () => {
    const db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const repo = new BlockRepository(db)

    const first = await repo.createWithDays('user-1', {
      programId: null, name: 'First', startDate: '2026-09-06', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null, days: [],
    })
    const second = await repo.createWithDays('user-1', {
      programId: null, name: 'Second', startDate: '2026-09-06', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null, days: [],
    })

    const found = await repo.findActiveForUser('user-1', '2026-09-06')
    expect(found?.id).toBe(second.id)
    expect(found?.id).not.toBe(first.id)
  })
})

describe('BlockRepository.findScheduleHistory', () => {
  let db: Client
  let repo: BlockRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new BlockRepository(db)
  })

  it('returns every block with its non-rest day count', async () => {
    await repo.createWithDays('user-1', {
      programId: null, name: 'A', startDate: '2026-01-01', endDate: '2026-02-01', trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [
        { name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [] },
        { name: 'Rest', dayOfWeek: 1, location: 'home', isRestDay: true, exercises: [] },
      ],
    })
    await repo.createWithDays('user-1', {
      programId: null, name: 'B', startDate: '2026-02-02', endDate: null, trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [],
    })

    expect(await repo.findScheduleHistory('user-1')).toEqual([
      { startDate: '2026-01-01', endDate: '2026-02-01', trainingDays: 1 },
      { startDate: '2026-02-02', endDate: null, trainingDays: 0 },
    ])
  })

  it('counts only the non-rest days of a split that mixes several of each', async () => {
    await repo.createWithDays('user-1', {
      programId: null, name: 'Four day', startDate: '2026-01-01', endDate: null, trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [
        { name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [] },
        { name: 'Rest', dayOfWeek: 1, location: 'home', isRestDay: true, exercises: [] },
        { name: 'Pull', dayOfWeek: 2, location: 'gym', exercises: [] },
        { name: 'Legs', dayOfWeek: 3, location: 'gym', exercises: [] },
        { name: 'Rest', dayOfWeek: 4, location: 'home', isRestDay: true, exercises: [] },
        { name: 'Upper', dayOfWeek: 5, location: 'gym', exercises: [] },
        { name: 'Rest', dayOfWeek: 6, location: 'home', isRestDay: true, exercises: [] },
      ],
    })

    expect(await repo.findScheduleHistory('user-1')).toEqual([
      { startDate: '2026-01-01', endDate: null, trainingDays: 4 },
    ])
  })

  it('returns an empty history for a user with no blocks', async () => {
    expect(await repo.findScheduleHistory('user-1')).toEqual([])
  })

  it("does not read another user's blocks", async () => {
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    await repo.createWithDays('user-1', {
      programId: null, name: 'Mine', startDate: '2026-01-01', endDate: null, trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [{ name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [] }],
    })
    await repo.createWithDays('user-2', {
      programId: null, name: 'Theirs', startDate: '2026-01-01', endDate: null, trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [
        { name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [] },
        { name: 'Pull', dayOfWeek: 1, location: 'gym', exercises: [] },
      ],
    })

    expect(await repo.findScheduleHistory('user-1')).toEqual([
      { startDate: '2026-01-01', endDate: null, trainingDays: 1 },
    ])
  })
})
