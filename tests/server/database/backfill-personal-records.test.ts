import { describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { backfillPersonalRecords } from '~~/server/database/backfill-personal-records'

const createUser = async (db: Client, id: string) =>
  db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: [id, `${id}@example.com`] })

const createExercise = async (db: Client, id: string) =>
  db.execute({ sql: `INSERT INTO exercises (id, name, instructions) VALUES (?, ?, '[]')`, args: [id, id] })

// Every set in a test lands in the same second, so ordering rests entirely on the rowid tiebreak
// -- which is exactly the case the backfill's ORDER BY has to get right.
const prsOf = async (db: Client) =>
  (await db.execute('SELECT set_log_id, pr_type FROM personal_records ORDER BY set_log_id, pr_type')).rows
    .map(row => `${row.set_log_id}:${row.pr_type}`)

describe('backfillPersonalRecords', () => {
  it('replays working sets in order and records PRs, idempotently', async () => {
    const db = await createTestDb()
    const sessions = new SessionRepository(db)
    await createUser(db, 'user-1')
    await createExercise(db, 'bench-press')
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null })
    await sessions.logSet({ id: 'b', exerciseLogId: 'e1', setNumber: 2, weightKg: 65, reps: 8, rpe: null })
    await sessions.logSet({ id: 'c', exerciseLogId: 'e1', setNumber: 3, weightKg: 65, reps: 9, rpe: null })

    await backfillPersonalRecords(db)
    await backfillPersonalRecords(db)

    expect(await prsOf(db)).toEqual(['b:e1rm', 'b:weight', 'c:e1rm', 'c:reps'])
  })

  it('records nothing for a user whose only set is their first ever', async () => {
    const db = await createTestDb()
    const sessions = new SessionRepository(db)
    await createUser(db, 'user-1')
    await createExercise(db, 'bench-press')
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 100, reps: 10, rpe: null })

    await backfillPersonalRecords(db)

    expect(await prsOf(db)).toEqual([])
  })

  it('skips warm-ups both as PRs and as baseline history', async () => {
    const db = await createTestDb()
    const sessions = new SessionRepository(db)
    await createUser(db, 'user-1')
    await createExercise(db, 'bench-press')
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null })
    // A heavy "warm-up" would have set a weight and e1RM PR had it counted, and would have raised
    // the baseline high enough to deny the working set that follows it.
    await sessions.logSet({ id: 'b', exerciseLogId: 'e1', setNumber: 2, weightKg: 200, reps: 8, rpe: null, isWarmup: true })
    await sessions.logSet({ id: 'c', exerciseLogId: 'e1', setNumber: 3, weightKg: 65, reps: 8, rpe: null })

    await backfillPersonalRecords(db)

    expect(await prsOf(db)).toEqual(['c:e1rm', 'c:weight'])
  })

  it('keeps history scoped per user and per exercise', async () => {
    const db = await createTestDb()
    const sessions = new SessionRepository(db)
    await createUser(db, 'user-1')
    await createUser(db, 'user-2')
    await createExercise(db, 'bench-press')
    await createExercise(db, 'squat')

    // user-1 benches heavy, then squats the same numbers a beginner user-2 is benching.
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'a1', exerciseLogId: 'e1', setNumber: 1, weightKg: 100, reps: 8, rpe: null })
    await sessions.logSet({ id: 'a2', exerciseLogId: 'e1', setNumber: 2, weightKg: 105, reps: 8, rpe: null })
    await sessions.addFreeformExercise({ id: 'e2', sessionId: 's1', exerciseId: 'squat', position: 1, setType: 'weight_reps' })
    await sessions.logSet({ id: 'b1', exerciseLogId: 'e2', setNumber: 1, weightKg: 60, reps: 8, rpe: null })
    await sessions.logSet({ id: 'b2', exerciseLogId: 'e2', setNumber: 2, weightKg: 62.5, reps: 8, rpe: null })

    await sessions.startSession('user-2', { id: 's2', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e3', sessionId: 's2', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'c1', exerciseLogId: 'e3', setNumber: 1, weightKg: 40, reps: 8, rpe: null })
    await sessions.logSet({ id: 'c2', exerciseLogId: 'e3', setNumber: 2, weightKg: 42.5, reps: 8, rpe: null })

    await backfillPersonalRecords(db)

    // Each second set beats only its own (user, exercise) baseline: no cross-contamination would
    // have let 100kg of bench deny a 62.5kg squat PR, or user-1 deny user-2 entirely.
    expect(await prsOf(db)).toEqual(['a2:e1rm', 'a2:weight', 'b2:e1rm', 'b2:weight', 'c2:e1rm', 'c2:weight'])
  })
})
