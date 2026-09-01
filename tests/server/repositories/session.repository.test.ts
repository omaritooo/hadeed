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

describe('SessionRepository logging', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', {
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
  })

  it('logs a set against an existing exercise log', async () => {
    const set = await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
    expect(set.version).toBe(1)

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises[0].sets).toHaveLength(1)
    expect(withLogs?.exercises[0].sets[0].weightKg).toBe(60)
  })

  it('adds a freeform exercise mid-session with no split_exercise_id or targets', async () => {
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })

    const exerciseLog = await repo.addFreeformExercise({
      id: 'exlog-2',
      sessionId: 'session-1',
      exerciseId: 'plank',
      position: 1,
      setType: 'time',
    })
    expect(exerciseLog.splitExerciseId).toBeNull()
    expect(exerciseLog.targetSets).toBeNull()

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises).toHaveLength(2)
  })
})

describe('SessionRepository idempotent replay', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('replaying startSession with the same id is a no-op, not a UNIQUE violation', async () => {
    const first = await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetReps: 8, targetRpe: 7 }],
    })
    const replay = await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetReps: 8, targetRpe: 7 }],
    })

    expect(replay.id).toBe(first.id)
    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises).toHaveLength(1)
  })

  it('replaying logSet with the same id is a no-op, even after the session was completed', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    const original = await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
    await repo.completeSession('session-1', 1)

    const replay = await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 999, reps: 1, rpe: 1 })

    expect(replay.weightKg).toBe(original.weightKg)
    const sets = await db.execute({ sql: 'SELECT COUNT(*) as count FROM set_logs WHERE id = ?', args: ['set-1'] })
    expect(sets.rows[0]!.count).toBe(1)
  })

  it('rejects a genuinely new set logged into a completed session', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })
    await repo.completeSession('session-1', 1)

    await expect(
      repo.logSet({ id: 'set-2', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 8, rpe: 7 }),
    ).rejects.toThrow(/not in progress/i)
  })

  it('rejects a genuinely new freeform exercise added to a completed session', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })
    await repo.completeSession('session-1', 1)

    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('squat', 'Squat', '[]')" })
    await expect(
      repo.addFreeformExercise({ id: 'exlog-2', sessionId: 'session-1', exerciseId: 'squat', position: 1, setType: 'weight_reps' }),
    ).rejects.toThrow(/not in progress/i)
  })

  it('replaying addFreeformExercise with the same id is a no-op, even after the session was completed', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    const original = await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })
    await repo.completeSession('session-1', 1)

    const replay = await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })

    expect(replay.id).toBe(original.id)
    const count = await db.execute({ sql: 'SELECT COUNT(*) as count FROM exercise_logs WHERE id = ?', args: ['exlog-1'] })
    expect(count.rows[0]!.count).toBe(1)
  })

  it('rejects logSet when the same id already belongs to a different exercise log, instead of disclosing the existing row', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'shared-id', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 137, reps: 3, rpe: 9 })

    await repo.startSession('user-1', { id: 'session-2', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'exlog-2', sessionId: 'session-2', exerciseId: 'plank', position: 0, setType: 'time' })

    await expect(
      repo.logSet({ id: 'shared-id', exerciseLogId: 'exlog-2', setNumber: 1, weightKg: 1, reps: 1, rpe: 1 }),
    ).rejects.toThrow(/different exercise log/i)
  })

  it('rejects addFreeformExercise when the same id already belongs to a different session, instead of disclosing the existing row', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'shared-id', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })

    await repo.startSession('user-1', { id: 'session-2', splitDayId: null, exercises: [] })

    await expect(
      repo.addFreeformExercise({ id: 'shared-id', sessionId: 'session-2', exerciseId: 'plank', position: 0, setType: 'time' }),
    ).rejects.toThrow(/different session/i)
  })

  it('rejects startSession when the same id already belongs to a different user', async () => {
    await repo.startSession('user-1', { id: 'shared-id', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO users (id, email) VALUES ('user-2', 'b@example.com')" })

    await expect(
      repo.startSession('user-2', { id: 'shared-id', splitDayId: null, exercises: [] }),
    ).rejects.toThrow(/different user/i)
  })

  it('rejects a new exercise added via startSession replay once the session is no longer in progress', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })
    await repo.completeSession('session-1', 1)

    await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: null,
      exercises: [{ id: 'exlog-injected', exerciseId: 'plank', splitExerciseId: null, position: 1, setType: 'time', targetSets: null, targetReps: null, targetRpe: null }],
    })

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises.map(e => e.id)).toEqual(['exlog-1'])
  })

  it('two concurrent replays of the same startSession never surface a raw UNIQUE constraint error', async () => {
    const call = () => repo.startSession('user-1', {
      id: 'race-session',
      splitDayId: 1,
      exercises: [{ id: 'race-exlog', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetReps: 8, targetRpe: 7 }],
    })

    const [first, second] = await Promise.all([call(), call()])
    expect(first.id).toBe('race-session')
    expect(second.id).toBe('race-session')

    const withLogs = await repo.findWithLogs('race-session')
    expect(withLogs?.exercises).toHaveLength(1)
  })

  it('two concurrent replays of the same logSet never surface a raw UNIQUE constraint error', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    const call = () => repo.logSet({ id: 'race-set', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })

    const [first, second] = await Promise.all([call(), call()])
    expect(first.weightKg).toBe(60)
    expect(second.weightKg).toBe(60)

    const count = await db.execute({ sql: 'SELECT COUNT(*) as count FROM set_logs WHERE id = ?', args: ['race-set'] })
    expect(count.rows[0]!.count).toBe(1)
  })

  it('two concurrent replays of the same addFreeformExercise never surface a raw UNIQUE constraint error', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    const call = () => repo.addFreeformExercise({ id: 'race-exlog', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })

    const [first, second] = await Promise.all([call(), call()])
    expect(first.id).toBe('race-exlog')
    expect(second.id).toBe('race-exlog')

    const count = await db.execute({ sql: 'SELECT COUNT(*) as count FROM exercise_logs WHERE id = ?', args: ['race-exlog'] })
    expect(count.rows[0]!.count).toBe(1)
  })
})

describe('SessionRepository.isComplete', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('a planned session with no split-linked exercise logs is not vacuously complete', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: 1, exercises: [] })
    expect(await repo.isComplete('session-1')).toBe(false)
  })

  it('a planned session is incomplete until every planned exercise hits its target set count', async () => {
    await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetReps: 8, targetRpe: 7 }],
    })

    expect(await repo.isComplete('session-1')).toBe(false)

    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
    await repo.logSet({ id: 'set-2', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 8, rpe: 7 })
    expect(await repo.isComplete('session-1')).toBe(false)

    await repo.logSet({ id: 'set-3', exerciseLogId: 'exlog-1', setNumber: 3, weightKg: 60, reps: 8, rpe: 7 })
    expect(await repo.isComplete('session-1')).toBe(true)
  })

  it('a freeform exercise added mid-session never blocks completion of the planned exercises', async () => {
    await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 1, targetReps: 8, targetRpe: 7 }],
    })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })

    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-2', sessionId: 'session-1', exerciseId: 'plank', position: 1, setType: 'time' })

    expect(await repo.isComplete('session-1')).toBe(true)
  })

  it('a freeform session is complete once it has at least one logged set anywhere', async () => {
    await repo.startSession('user-1', { id: 'session-2', splitDayId: null, exercises: [] })
    expect(await repo.isComplete('session-2')).toBe(false)

    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-3', sessionId: 'session-2', exerciseId: 'plank', position: 0, setType: 'time' })
    expect(await repo.isComplete('session-2')).toBe(false)

    await repo.logSet({ id: 'set-4', exerciseLogId: 'exlog-3', setNumber: 1, weightKg: null, reps: null, rpe: null })
    expect(await repo.isComplete('session-2')).toBe(true)
  })

  it('a planned exercise with no prescribed target sets still requires at least one logged set', async () => {
    await repo.startSession('user-1', {
      id: 'session-3',
      splitDayId: 1,
      exercises: [{ id: 'exlog-4', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: null, targetReps: null, targetRpe: null }],
    })

    expect(await repo.isComplete('session-3')).toBe(false)

    await repo.logSet({ id: 'set-5', exerciseLogId: 'exlog-4', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
    expect(await repo.isComplete('session-3')).toBe(true)
  })
})

describe('SessionRepository.completeSession', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })
  })

  it('completes a session when the expected version matches', async () => {
    const result = await repo.completeSession('session-1', 1)
    expect(result.conflict).toBe(false)
    if (!result.conflict) {
      expect(result.session.status).toBe('completed')
      expect(result.session.version).toBe(2)
      expect(result.session.completedAt).not.toBeNull()
    }
  })

  it('reports a conflict, and records it, when the expected version is stale', async () => {
    await repo.completeSession('session-1', 1)

    const result = await repo.completeSession('session-1', 1)
    expect(result.conflict).toBe(true)

    const conflicts = await db.execute({ sql: 'SELECT * FROM sync_conflicts WHERE entity_id = ?', args: ['session-1'] })
    expect(conflicts.rows).toHaveLength(1)
    expect(conflicts.rows[0].entity_table).toBe('workout_sessions')
  })
})

describe('SessionRepository.editSetLog', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench-press-2', 'Bench', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'bench-press-2', position: 0, setType: 'weight_reps' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
  })

  it('applies a correction when the expected version matches', async () => {
    const result = await repo.editSetLog('set-1', 1, { weightKg: 62.5 })
    expect(result.conflict).toBe(false)
    if (!result.conflict) {
      expect(result.setLog.weightKg).toBe(62.5)
      expect(result.setLog.version).toBe(2)
    }
  })

  it('records a conflict instead of silently overwriting when the expected version is stale', async () => {
    await repo.editSetLog('set-1', 1, { weightKg: 62.5 })

    const result = await repo.editSetLog('set-1', 1, { weightKg: 999 })
    expect(result.conflict).toBe(true)

    const stillCorrect = await db.execute({ sql: 'SELECT weight_kg FROM set_logs WHERE id = ?', args: ['set-1'] })
    expect(stillCorrect.rows[0].weight_kg).toBe(62.5)

    const conflicts = await db.execute({ sql: 'SELECT * FROM sync_conflicts WHERE entity_id = ?', args: ['set-1'] })
    expect(conflicts.rows).toHaveLength(1)
    expect(conflicts.rows[0].entity_table).toBe('set_logs')
  })

  it('rejects an empty corrections object instead of building broken SQL', async () => {
    await expect(repo.editSetLog('set-1', 1, {})).rejects.toThrow('No corrections provided')
  })

  it('applies corrections to weightKg, reps, and rpe together in one call', async () => {
    const result = await repo.editSetLog('set-1', 1, { weightKg: 65, reps: 6, rpe: 8.5 })
    expect(result.conflict).toBe(false)
    if (!result.conflict) {
      expect(result.setLog.weightKg).toBe(65)
      expect(result.setLog.reps).toBe(6)
      expect(result.setLog.rpe).toBe(8.5)
      expect(result.setLog.version).toBe(2)
    }
  })
})

describe('SessionRepository.findSetLogOwnerId', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('resolves the owning userId for a given set log', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })

    expect(await repo.findSetLogOwnerId('set-1')).toBe('user-1')
  })

  it('returns null for a set log that does not exist', async () => {
    expect(await repo.findSetLogOwnerId('nonexistent')).toBeNull()
  })
})

describe('SessionRepository.findExerciseLogOwnerId', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('resolves the owning userId for a given exercise log', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })

    expect(await repo.findExerciseLogOwnerId('exlog-1')).toBe('user-1')
  })

  it('returns null for an exercise log that does not exist', async () => {
    expect(await repo.findExerciseLogOwnerId('nonexistent')).toBeNull()
  })
})

describe('SessionRepository.expireStaleSessions', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
  })

  it('marks an in-progress session older than 12 hours as abandoned', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({
      sql: `UPDATE workout_sessions SET started_at = datetime('now', '-13 hours') WHERE id = ?`,
      args: ['session-1'],
    })

    await repo.expireStaleSessions('user-1')

    const session = await repo.findSessionById('session-1')
    expect(session?.status).toBe('abandoned')
  })

  it('leaves a recent in-progress session untouched', async () => {
    await repo.startSession('user-1', { id: 'session-2', splitDayId: null, exercises: [] })
    await repo.expireStaleSessions('user-1')

    const session = await repo.findSessionById('session-2')
    expect(session?.status).toBe('in_progress')
  })

  it('never touches an already-completed session', async () => {
    await repo.startSession('user-1', { id: 'session-3', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-3', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })
    await repo.completeSession('session-3', 1)
    await db.execute({
      sql: `UPDATE workout_sessions SET started_at = datetime('now', '-13 hours') WHERE id = ?`,
      args: ['session-3'],
    })

    await repo.expireStaleSessions('user-1')

    const session = await repo.findSessionById('session-3')
    expect(session?.status).toBe('completed')
  })

  it('does not abandon a session exactly at the 12-hour boundary', async () => {
    await repo.startSession('user-1', { id: 'session-4', splitDayId: null, exercises: [] })
    await db.execute({
      sql: `UPDATE workout_sessions SET started_at = datetime('now', '-12 hours') WHERE id = ?`,
      args: ['session-4'],
    })

    await repo.expireStaleSessions('user-1')

    const session = await repo.findSessionById('session-4')
    expect(session?.status).toBe('in_progress')
  })
})

describe('SessionRepository.countTrainedDaysInRange', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
  })

  async function completeFreeformSession(sessionId: string, exlogId: string, setId: string) {
    await repo.startSession('user-1', { id: sessionId, splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: exlogId, sessionId, exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: setId, exerciseLogId: exlogId, setNumber: 1, weightKg: null, reps: null, rpe: null })
    await repo.completeSession(sessionId, 1)
  }

  it('counts distinct calendar days with at least one completed session, planned or freeform', async () => {
    await completeFreeformSession('session-1', 'exlog-1', 'set-1')

    const count = await repo.countTrainedDaysInRange('user-1', '2000-01-01', '2100-01-01')
    expect(count).toBe(1)
  })

  it('dedupes two completed sessions on the same calendar day down to a count of 1', async () => {
    await completeFreeformSession('session-1', 'exlog-1', 'set-1')
    await completeFreeformSession('session-2', 'exlog-2', 'set-2')

    const count = await repo.countTrainedDaysInRange('user-1', '2000-01-01', '2100-01-01')
    expect(count).toBe(1)
  })

  it('excludes an in-progress session from the count', async () => {
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })

    const count = await repo.countTrainedDaysInRange('user-1', '2000-01-01', '2100-01-01')
    expect(count).toBe(0)
  })

  it('excludes a completed session that falls just outside the [start, end) range', async () => {
    await completeFreeformSession('session-1', 'exlog-1', 'set-1')
    await db.execute({
      sql: `UPDATE workout_sessions SET started_at = ? WHERE id = ?`,
      args: ['2019-12-31 23:59:59', 'session-1'],
    })

    const count = await repo.countTrainedDaysInRange('user-1', '2020-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
    expect(count).toBe(0)
  })
})
