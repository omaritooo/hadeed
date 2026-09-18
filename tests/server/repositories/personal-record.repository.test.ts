import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'

describe('PersonalRecordRepository', () => {
  let db: Client
  let sessions: SessionRepository
  let repo: PersonalRecordRepository

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    repo = new PersonalRecordRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`)
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'e1', setNumber: 1, weightKg: 100, reps: 5, rpe: null })
  })

  const record = () => repo.insertMany({
    userId: 'user-1',
    exerciseId: 'bench-press',
    setLogId: 'set-1',
    achievedAt: '2026-01-01 10:00:00',
    prs: [{ type: 'weight', value: 100, previousValue: 95 }, { type: 'e1rm', value: 116.7, previousValue: 110 }],
  })

  it('groups a set\'s PR types for the session summary', async () => {
    await record()
    expect(await repo.findForSession('user-1', 's1')).toEqual([
      { exerciseName: 'Bench Press', weightKg: 100, reps: 5, prTypes: ['e1rm', 'weight'], e1rmKg: 116.7 },
    ])
  })

  it('is idempotent per (set, type)', async () => {
    await record()
    await record()
    expect((await db.execute('SELECT COUNT(*) AS n FROM personal_records')).rows[0]!.n).toBe(2)
  })

  it('lists recent PRs newest first, capped by an optional limit', async () => {
    await sessions.logSet({ id: 'set-2', exerciseLogId: 'e1', setNumber: 2, weightKg: 110, reps: 5, rpe: null })
    await sessions.logSet({ id: 'set-3', exerciseLogId: 'e1', setNumber: 3, weightKg: 120, reps: 5, rpe: null })
    await record()
    await repo.insertMany({ userId: 'user-1', exerciseId: 'bench-press', setLogId: 'set-2', achievedAt: '2026-01-02 10:00:00', prs: [{ type: 'weight', value: 110, previousValue: 100 }] })
    await repo.insertMany({ userId: 'user-1', exerciseId: 'bench-press', setLogId: 'set-3', achievedAt: '2026-01-03 10:00:00', prs: [{ type: 'weight', value: 120, previousValue: 110 }] })

    expect((await repo.recent('user-1')).map(pr => pr.weightKg)).toEqual([120, 110, 100])
    expect((await repo.recent('user-1', 2)).map(pr => pr.weightKg)).toEqual([120, 110])
    expect((await repo.recent('user-1'))[2]).toMatchObject({ prTypes: ['e1rm', 'weight'], achievedAt: '2026-01-01 10:00:00' })
  })

  // logged_at (and so achieved_at, which is copied from it) only has second resolution, so several
  // sets of one exercise routinely share a timestamp. rowid breaks the tie the way the rest of the
  // repository layer does, keeping the newest set on top instead of ordering nondeterministically.
  it('breaks a same-second tie by insertion order', async () => {
    await sessions.logSet({ id: 'set-2', exerciseLogId: 'e1', setNumber: 2, weightKg: 110, reps: 5, rpe: null })
    await record()
    await repo.insertMany({ userId: 'user-1', exerciseId: 'bench-press', setLogId: 'set-2', achievedAt: '2026-01-01 10:00:00', prs: [{ type: 'weight', value: 110, previousValue: 100 }] })

    expect((await repo.recent('user-1')).map(pr => pr.weightKg)).toEqual([110, 100])
  })

  it('deletes a set\'s PRs', async () => {
    await record()
    await repo.deleteForSet('set-1')
    expect(await repo.findForSession('user-1', 's1')).toEqual([])
  })

  it('cascades when the set is deleted', async () => {
    await record()
    await sessions.deleteSetLog('set-1')
    expect((await db.execute('SELECT COUNT(*) AS n FROM personal_records')).rows[0]!.n).toBe(0)
  })
})
