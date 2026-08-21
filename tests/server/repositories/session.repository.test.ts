import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'

async function seedUserAndBlock(db: Client) {
  await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  await db.execute({ sql: 'INSERT INTO programs (id, user_id, name) VALUES (1, ?, ?)', args: ['user-1', 'Program'] })
  await db.execute({
    sql: `INSERT INTO blocks (id, program_id, user_id, name, start_date) VALUES (1, 1, ?, 'Block', '2026-01-01')`,
    args: ['user-1'],
  })
  await db.execute({
    sql: `INSERT INTO split_days (id, block_id, name, day_of_week, location, is_rest_day) VALUES (1, 1, 'Push', 1, 'gym', 0)`,
  })
  await db.execute({
    sql: `INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`,
  })
  await db.execute({
    sql: `INSERT INTO split_exercises (id, split_day_id, exercise_id, position, set_type, target_sets, target_reps, target_rpe)
          VALUES (1, 1, 'bench-press', 0, 'weight_reps', 3, 8, 7)`,
  })
}

describe('SessionRepository.startSession', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('starts a planned session with the client-supplied exercise-log snapshot', async () => {
    const session = await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{
        id: 'exlog-1',
        exerciseId: 'bench-press',
        splitExerciseId: 1,
        position: 0,
        setType: 'weight_reps',
        targetSets: 3,
        targetReps: 8,
        targetRpe: 7,
      }],
    })

    expect(session.id).toBe('session-1')
    expect(session.status).toBe('in_progress')
    expect(session.version).toBe(1)

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises).toHaveLength(1)
    expect(withLogs?.exercises[0].targetSets).toBe(3)
  })

  it('starts a freeform session with no split day and no exercises', async () => {
    const session = await repo.startSession('user-1', { id: 'session-2', splitDayId: null, exercises: [] })
    expect(session.splitDayId).toBeNull()

    const withLogs = await repo.findWithLogs('session-2')
    expect(withLogs?.exercises).toHaveLength(0)
  })
})
