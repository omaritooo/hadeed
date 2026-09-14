import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository, type StartSessionExerciseInput } from '~~/server/repositories/session.repository'
import { MuscleRepository } from '~~/server/repositories/muscle.repository'

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
    sql: `INSERT INTO split_exercises (id, split_day_id, exercise_id, position, set_type, target_sets, target_reps_min, target_reps_max, target_rpe)
          VALUES (1, 1, 'bench-press', 0, 'weight_reps', 3, 8, 8, 7)`,
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
        targetRepsMin: 8,
        targetRepsMax: 8,
        targetRpe: 7,
      }],
    })

    expect(session.id).toBe('session-1')
    expect(session.status).toBe('in_progress')
    expect(session.version).toBe(1)

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises).toHaveLength(1)
    expect(withLogs?.exercises[0].targetSets).toBe(3)
    expect(withLogs?.exercises[0].exerciseName).toBe('Bench Press')
  })

  it('starts a freeform session with no split day and no exercises', async () => {
    const session = await repo.startSession('user-1', { id: 'session-2', splitDayId: null, exercises: [] })
    expect(session.splitDayId).toBeNull()

    const withLogs = await repo.findWithLogs('session-2')
    expect(withLogs?.exercises).toHaveLength(0)
  })

  it('defaults format/rounds to straight_sets/1 when not provided', async () => {
    const session = await repo.startSession('user-1', { id: 'session-3', splitDayId: null, exercises: [] })
    expect(session.format).toBe('straight_sets')
    expect(session.rounds).toBe(1)
  })

  it('dual-writes target_reps as the range minimum and reads a row that only has target_reps set', async () => {
    await repo.startSession('user-1', {
      id: 'session-5',
      splitDayId: 1,
      exercises: [{ id: 'exlog-5', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRpe: 7 }],
    })

    const row = (await db.execute({ sql: 'SELECT target_reps, target_reps_min, target_reps_max FROM exercise_logs WHERE id = ?', args: ['exlog-5'] })).rows[0]!
    expect([row.target_reps, row.target_reps_min, row.target_reps_max]).toEqual([8, 8, 10])

    await db.execute({ sql: 'UPDATE exercise_logs SET target_reps = 6, target_reps_min = NULL, target_reps_max = NULL WHERE id = ?', args: ['exlog-5'] })
    const exercise = (await repo.findWithLogs('session-5'))?.exercises[0]
    expect(exercise?.targetRepsMin).toBe(6)
    expect(exercise?.targetRepsMax).toBe(6)
  })

  it('stores the prescription from a legacy payload that sends targetReps and omits nullable fields', async () => {
    // An older PWA build posts a single targetReps and may leave out splitExerciseId / targetRpe.
    const legacyExercise = { id: 'exlog-6', exerciseId: 'bench-press', position: 0, setType: 'weight_reps', targetSets: 3, targetReps: 8 }
    await repo.startSession('user-1', {
      id: 'session-6',
      splitDayId: 1,
      exercises: [legacyExercise as unknown as StartSessionExerciseInput],
    })

    const exercise = (await repo.findWithLogs('session-6'))?.exercises[0]
    expect(exercise).toMatchObject({ targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetRpe: null, splitExerciseId: null })
    const row = (await db.execute({ sql: 'SELECT target_reps FROM exercise_logs WHERE id = ?', args: ['exlog-6'] })).rows[0]!
    expect(row.target_reps).toBe(8)
  })

  it('snapshots format/rounds from the originating circuit split day', async () => {
    const session = await repo.startSession('user-1', {
      id: 'session-4',
      splitDayId: 1,
      format: 'circuit',
      rounds: 4,
      exercises: [{
        id: 'exlog-2',
        exerciseId: 'bench-press',
        splitExerciseId: 1,
        position: 0,
        setType: 'weight_reps',
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 8,
        targetRpe: 7,
      }],
    })

    expect(session.format).toBe('circuit')
    expect(session.rounds).toBe(4)

    const withLogs = await repo.findWithLogs('session-4')
    expect(withLogs?.format).toBe('circuit')
    expect(withLogs?.rounds).toBe(4)
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
        targetRepsMin: 8,
        targetRepsMax: 8,
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
    expect(exerciseLog.targetRepsMin).toBeNull()
    expect(exerciseLog.targetRepsMax).toBeNull()
    const row = (await db.execute({ sql: 'SELECT target_reps FROM exercise_logs WHERE id = ?', args: ['exlog-2'] })).rows[0]!
    expect(row.target_reps).toBeNull()

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises).toHaveLength(2)
    expect(withLogs?.exercises[1].exerciseName).toBe('Plank')
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
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 7 }],
    })
    const replay = await repo.startSession('user-1', {
      id: 'session-1',
      splitDayId: 1,
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 7 }],
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
      exercises: [{ id: 'exlog-injected', exerciseId: 'plank', splitExerciseId: null, position: 1, setType: 'time', targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRpe: null }],
    })

    const withLogs = await repo.findWithLogs('session-1')
    expect(withLogs?.exercises.map(e => e.id)).toEqual(['exlog-1'])
  })

  it('two concurrent replays of the same startSession never surface a raw UNIQUE constraint error', async () => {
    const call = () => repo.startSession('user-1', {
      id: 'race-session',
      splitDayId: 1,
      exercises: [{ id: 'race-exlog', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 7 }],
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

  it('can retroactively flip a set to (and back from) a warm-up', async () => {
    const marked = await repo.editSetLog('set-1', 1, { isWarmup: true })
    expect(marked.conflict).toBe(false)
    if (!marked.conflict) expect(marked.setLog.isWarmup).toBe(true)

    const unmarked = await repo.editSetLog('set-1', 2, { isWarmup: false })
    expect(unmarked.conflict).toBe(false)
    if (!unmarked.conflict) expect(unmarked.setLog.isWarmup).toBe(false)
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

describe('SessionRepository.findRecentCompletedSummaries', () => {
  let db: Client
  let sessions: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('squat', 'Squat', '[]')" })
  })

  it('findRecentCompletedSummaries returns multiple sessions, most recent first', async () => {
    for (const [id, weight] of [['s1', 100], ['s2', 110], ['s3', 120]] as const) {
      await sessions.startSession('user-1', { id, splitDayId: null, exercises: [] })
      await sessions.addFreeformExercise({ id: `${id}-ex`, sessionId: id, exerciseId: 'squat', position: 0, setType: 'weight_reps' })
      await sessions.logSet({ id: `${id}-set`, exerciseLogId: `${id}-ex`, setNumber: 1, weightKg: weight, reps: 5, rpe: 8 })
      await sessions.completeSession(id, 1)
    }

    const results = await sessions.findRecentCompletedSummaries('user-1', 2)

    expect(results).toHaveLength(2)
    expect(results[0]?.sessionId).toBe('s3')
    expect(results[1]?.sessionId).toBe('s2')
  })

  it('findRecentCompletedSummaries breaks a completed_at tie by rowid, favoring the later-inserted session', async () => {
    for (const [id, weight] of [['s1', 100], ['s2', 110]] as const) {
      await sessions.startSession('user-1', { id, splitDayId: null, exercises: [] })
      await sessions.addFreeformExercise({ id: `${id}-ex`, sessionId: id, exerciseId: 'squat', position: 0, setType: 'weight_reps' })
      await sessions.logSet({ id: `${id}-set`, exerciseLogId: `${id}-ex`, setNumber: 1, weightKg: weight, reps: 5, rpe: 8 })
      await sessions.completeSession(id, 1)
    }

    // Force an identical completed_at on both rows to simulate two sessions completing within
    // the same second (datetime('now') has only second-level resolution). s2 has the higher
    // rowid since it was inserted after s1, so it should still sort first.
    await db.execute({ sql: 'UPDATE workout_sessions SET completed_at = ? WHERE id IN (?, ?)', args: ['2026-01-01 12:00:00', 's1', 's2'] })

    const results = await sessions.findRecentCompletedSummaries('user-1', 2)

    expect(results).toHaveLength(2)
    expect(results[0]?.completedAt).toBe(results[1]?.completedAt)
    expect(results[0]?.sessionId).toBe('s2')
    expect(results[1]?.sessionId).toBe('s1')
  })

  it('findRecentCompletedSummaries populates day name, duration, and the top set by weight then reps', async () => {
    await db.execute({ sql: 'INSERT INTO programs (id, user_id, name) VALUES (1, ?, ?)', args: ['user-1', 'Program'] })
    await db.execute({ sql: `INSERT INTO blocks (id, program_id, user_id, name, start_date) VALUES (1, 1, ?, 'Block', '2026-01-01')`, args: ['user-1'] })
    await db.execute({ sql: `INSERT INTO split_days (id, block_id, name, day_of_week, location, is_rest_day) VALUES (1, 1, 'Leg Day', 1, 'gym', 0)` })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('deadlift', 'Deadlift', '[]')" })

    await sessions.startSession('user-1', { id: 's1', splitDayId: 1, exercises: [] })
    await sessions.addFreeformExercise({ id: 's1-squat', sessionId: 's1', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.addFreeformExercise({ id: 's1-deadlift', sessionId: 's1', exerciseId: 'deadlift', position: 1, setType: 'weight_reps' })
    // Lower weight but more reps than the deadlift set below - should lose the tiebreak on weight_kg.
    await sessions.logSet({ id: 's1-squat-set', exerciseLogId: 's1-squat', setNumber: 1, weightKg: 100, reps: 20, rpe: 8 })
    // Two deadlift sets at the same weight - the one with more reps should win the tiebreak.
    await sessions.logSet({ id: 's1-deadlift-set-1', exerciseLogId: 's1-deadlift', setNumber: 1, weightKg: 150, reps: 5, rpe: 8 })
    await sessions.logSet({ id: 's1-deadlift-set-2', exerciseLogId: 's1-deadlift', setNumber: 2, weightKg: 150, reps: 8, rpe: 9 })
    await sessions.completeSession('s1', 1)
    await db.execute({
      sql: `UPDATE workout_sessions SET started_at = '2026-01-01 12:00:00', completed_at = '2026-01-01 12:45:00' WHERE id = 's1'`,
    })

    const [result] = await sessions.findRecentCompletedSummaries('user-1', 1)

    expect(result?.dayName).toBe('Leg Day')
    expect(result?.durationMinutes).toBe(45)
    expect(result?.topExerciseName).toBe('Deadlift')
    expect(result?.topWeightKg).toBe(150)
    expect(result?.topReps).toBe(8)
  })

  it('findRecentCompletedSummaries returns an empty array when there are no completed sessions', async () => {
    const results = await sessions.findRecentCompletedSummaries('user-1', 5)
    expect(results).toEqual([])
  })

  it('findMostRecentCompletedSummary delegates to findRecentCompletedSummaries with a limit of 1', async () => {
    for (const [id, weight] of [['s1', 100], ['s2', 110]] as const) {
      await sessions.startSession('user-1', { id, splitDayId: null, exercises: [] })
      await sessions.addFreeformExercise({ id: `${id}-ex`, sessionId: id, exerciseId: 'squat', position: 0, setType: 'weight_reps' })
      await sessions.logSet({ id: `${id}-set`, exerciseLogId: `${id}-ex`, setNumber: 1, weightKg: weight, reps: 5, rpe: 8 })
      await sessions.completeSession(id, 1)
    }

    const summary = await sessions.findMostRecentCompletedSummary('user-1')

    expect(summary?.sessionId).toBe('s2')
    expect(summary?.topWeightKg).toBe(110)
  })

  it('findMostRecentCompletedSummary returns null when there are no completed sessions', async () => {
    const summary = await sessions.findMostRecentCompletedSummary('user-1')
    expect(summary).toBeNull()
  })
})

describe('SessionRepository.findLastPerformedForExercises', () => {
  let db: Client
  let sessions: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('squat', 'Squat', '[]')" })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench', 'Bench', '[]')" })
  })

  it('returns the top set from the most recent session per exercise, not the heaviest ever', async () => {
    // Older session: heavier squat set.
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 's1-squat', sessionId: 's1', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 's1-squat-set', exerciseLogId: 's1-squat', setNumber: 1, weightKg: 140, reps: 3, rpe: 9 })
    await sessions.completeSession('s1', 1)
    await db.execute({ sql: `UPDATE workout_sessions SET started_at = '2026-01-01 12:00:00', completed_at = '2026-01-01 12:30:00' WHERE id = 's1'` })

    // Newer session: lighter squat set, should still win because it's more recent.
    await sessions.startSession('user-1', { id: 's2', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 's2-squat', sessionId: 's2', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 's2-squat-set-1', exerciseLogId: 's2-squat', setNumber: 1, weightKg: 100, reps: 5, rpe: 7 })
    // Same weight, more reps - should win the within-session tiebreak.
    await sessions.logSet({ id: 's2-squat-set-2', exerciseLogId: 's2-squat', setNumber: 2, weightKg: 100, reps: 8, rpe: 8 })
    await sessions.completeSession('s2', 1)
    await db.execute({ sql: `UPDATE workout_sessions SET started_at = '2026-01-05 12:00:00', completed_at = '2026-01-05 12:30:00' WHERE id = 's2'` })

    const result = await sessions.findLastPerformedForExercises('user-1', ['squat', 'bench'])

    expect(result.squat).toEqual({ weightKg: 100, reps: 8, date: '2026-01-05 12:30:00' })
    expect(result.bench).toBeUndefined()
  })

  it('breaks a same-timestamp session tie by favoring the later-inserted session', async () => {
    for (const [id, weight] of [['s1', 100], ['s2', 110]] as const) {
      await sessions.startSession('user-1', { id, splitDayId: null, exercises: [] })
      await sessions.addFreeformExercise({ id: `${id}-ex`, sessionId: id, exerciseId: 'squat', position: 0, setType: 'weight_reps' })
      await sessions.logSet({ id: `${id}-set`, exerciseLogId: `${id}-ex`, setNumber: 1, weightKg: weight, reps: 5, rpe: 8 })
      await sessions.completeSession(id, 1)
    }
    await db.execute({ sql: 'UPDATE workout_sessions SET completed_at = ? WHERE id IN (?, ?)', args: ['2026-01-01 12:00:00', 's1', 's2'] })

    const result = await sessions.findLastPerformedForExercises('user-1', ['squat'])

    expect(result.squat?.weightKg).toBe(110)
  })

  it('returns an empty object for an empty exerciseIds array', async () => {
    const result = await sessions.findLastPerformedForExercises('user-1', [])
    expect(result).toEqual({})
  })
})

describe('SessionRepository warm-up exclusion from PR baseline and history', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')" })
    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
  })

  it('a heavy warm-up set does not become the PR baseline, so a subsequent lighter working set still registers as a PR', async () => {
    // A warm-up at 100kg would be a PR if it counted - it should not raise the baseline at all.
    const warmup = await repo.logSet({ id: 'set-warmup', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 100, reps: 5, rpe: 6, isWarmup: true })
    expect(warmup.isWarmup).toBe(true)

    const baselineAfterWarmup = await repo.findBestWeightForExercise('user-1', 'bench-press')
    expect(baselineAfterWarmup).toBeNull()

    // Mirrors the route's isNewPr check: no real best on record, so even the warm-up's own
    // weight would need isNewPersonalRecord to say false - covered directly in pr.test.ts.
    // Here we confirm the baseline the route reads is unaffected by the warm-up.
    const workingWeight = 60
    const isNewPr = workingWeight != null && (baselineAfterWarmup === null || workingWeight > baselineAfterWarmup)
    expect(isNewPr).toBe(true)

    const working = await repo.logSet({ id: 'set-working', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: workingWeight, reps: 8, rpe: 8, isWarmup: false })
    expect(working.isWarmup).toBe(false)

    // The working set now establishes the real baseline; the warm-up is still excluded.
    const baselineAfterWorking = await repo.findBestWeightForExercise('user-1', 'bench-press')
    expect(baselineAfterWorking).toBe(60)
  })

  it('excludes a warm-up set from findExerciseHistory and findLastPerformedForExercises', async () => {
    await repo.logSet({ id: 'set-warmup', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 100, reps: 5, rpe: 6, isWarmup: true })
    await repo.logSet({ id: 'set-working', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 8, rpe: 8, isWarmup: false })
    await repo.completeSession('session-1', 1)

    const history = await repo.findExerciseHistory('user-1', 'bench-press')
    expect(history).toHaveLength(1)
    expect(history[0]?.topSetWeightKg).toBe(60)
    expect(history[0]?.setsCount).toBe(1)

    const lastPerformed = await repo.findLastPerformedForExercises('user-1', ['bench-press'])
    expect(lastPerformed['bench-press']).toEqual({ weightKg: 60, reps: 8, date: history[0]?.date })
  })

  it('returns every working set in set order from findExerciseHistory, not just the top set', async () => {
    await repo.logSet({ id: 'set-warmup', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 40, reps: 12, rpe: 4, isWarmup: true })
    await repo.logSet({ id: 'set-a', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 10, rpe: 7, isWarmup: false })
    await repo.logSet({ id: 'set-b', exerciseLogId: 'exlog-1', setNumber: 3, weightKg: 70, reps: 8, rpe: 8, isWarmup: false })
    await repo.logSet({ id: 'set-c', exerciseLogId: 'exlog-1', setNumber: 4, weightKg: 65, reps: 9, rpe: 9, isWarmup: false })

    const history = await repo.findExerciseHistory('user-1', 'bench-press')
    expect(history).toHaveLength(1)
    expect(history[0]?.topSetWeightKg).toBe(70)
    expect(history[0]?.topSetReps).toBe(8)
    expect(history[0]?.setsCount).toBe(3)
    expect(history[0]?.sets).toEqual([
      { setNumber: 2, weightKg: 60, reps: 10 },
      { setNumber: 3, weightKg: 70, reps: 8 },
      { setNumber: 4, weightKg: 65, reps: 9 },
    ])
  })

  it('excludes a warm-up set from weeklySetsByMuscle', async () => {
    const { MuscleRepository } = await import('~~/server/repositories/muscle.repository')
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: ['bench-press', chest.id, 'primary'] })

    await repo.logSet({ id: 'set-warmup', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 20, reps: 15, rpe: 4, isWarmup: true })
    await repo.logSet({ id: 'set-working', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 8, rpe: 8, isWarmup: false })

    const results = await repo.weeklySetsByMuscle('user-1', '2020-01-01 00:00:00', '2030-01-01 00:00:00')
    expect(results).toEqual([{ muscleId: chest.id, muscleName: 'chest', setCount: 1 }])
  })

  it('excludes a warm-up set from volumeKgInRange but includes it in totalVolumeKg', async () => {
    await repo.logSet({ id: 'set-warmup', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 20, reps: 10, rpe: 4, isWarmup: true })
    await repo.logSet({ id: 'set-working', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 8, rpe: 8, isWarmup: false })

    const weeklyVolume = await repo.volumeKgInRange('user-1', '2020-01-01 00:00:00', '2030-01-01 00:00:00')
    expect(weeklyVolume).toBe(60 * 8)

    const totalVolume = await repo.totalVolumeKg('user-1')
    expect(totalVolume).toBe(20 * 10 + 60 * 8)
  })

  it('excludes a warm-up set from sessionVolumeKg', async () => {
    await repo.logSet({ id: 'set-warmup', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 20, reps: 10, rpe: 4, isWarmup: true })
    await repo.logSet({ id: 'set-working', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 8, rpe: 8, isWarmup: false })

    const sessionVolume = await repo.sessionVolumeKg('session-1')
    expect(sessionVolume).toBe(60 * 8)
  })
})

describe('SessionRepository.weeklySetsByMuscle', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench', '[]')" })
  })

  it('counts distinct logged sets per primary muscle within a date range', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: ['bench-press', chest.id, 'primary'] })

    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })
    await repo.logSet({ id: 'set-2', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 60, reps: 8, rpe: 7 })

    const results = await repo.weeklySetsByMuscle('user-1', '2020-01-01 00:00:00', '2030-01-01 00:00:00')
    expect(results).toEqual([{ muscleId: chest.id, muscleName: 'chest', setCount: 2 }])
  })

  it('only counts sets within the given date range', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: ['bench-press', chest.id, 'primary'] })

    await repo.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await repo.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })

    // Push the logged set's timestamp just outside the query range, following the same
    // out-of-range boundary convention as countTrainedDaysInRange's own range test.
    await db.execute({
      sql: `UPDATE set_logs SET logged_at = ? WHERE id = ?`,
      args: ['2019-12-31 23:59:59', 'set-1'],
    })

    const results = await repo.weeklySetsByMuscle('user-1', '2020-01-01 00:00:00', '2030-01-01 00:00:00')
    expect(results).toEqual([])
  })
})
