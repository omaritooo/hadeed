import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { SessionService } from '~~/server/services/session.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

function ctx(userId = 'user-1'): RequestContext {
  return { userId, roles: [], permissions: [] }
}

async function seedUserWithActiveBlock(db: Client, trainingDays: number) {
  await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  const blocks = new BlockRepository(db)
  await blocks.createWithDays('user-1', {
    programId: null,
    name: 'Block',
    startDate: '2020-01-01',
    endDate: null,
    trainingDayMacroTarget: null,
    restDayMacroTarget: null,
    days: Array.from({ length: trainingDays }, (_, i) => ({
      name: `Day ${i}`, dayOfWeek: i, location: 'gym' as const, exercises: [],
    })),
  })
}

describe('SessionService', () => {
  let db: Client
  let sessions: SessionRepository
  let xp: XpRepository
  let streaks: StreakRepository
  let service: SessionService
  let onSessionCompleted: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    xp = new XpRepository(db)
    streaks = new StreakRepository(db)
    onSessionCompleted = vi.fn()
    service = new SessionService(ctx(), sessions, new BlockRepository(db), { onSessionCompleted } as never, xp, streaks)
  })

  it('rejects completing a session owned by someone else', async () => {
    await seedUserWithActiveBlock(db, 1)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    await sessions.startSession('user-2', { id: 'session-1', splitDayId: null, exercises: [] })

    await expect(service.completeSession('session-1', 1)).rejects.toThrow(/forbidden/i)
  })

  it('calls GamificationService.onSessionCompleted with the computed weekly facts', async () => {
    await seedUserWithActiveBlock(db, 2)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })

    await service.completeSession('session-1', 1)

    expect(onSessionCompleted).toHaveBeenCalledTimes(1)
    const [userId, sessionId, facts] = onSessionCompleted.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(sessionId).toBe('session-1')
    expect(facts.scheduledDaysThisWeek).toBe(2)
    expect(facts.completedDaysThisWeek).toBe(1)
    expect(facts.missedScheduledDay).toBe(false)
  })

  it('allows completing a planned session that has not hit its target sets', async () => {
    await seedUserWithActiveBlock(db, 1)
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench', '[]')" })
    const day = await db.execute({ sql: 'SELECT id FROM split_days LIMIT 1' })
    const splitDayId = day.rows[0]!.id as number
    await db.execute({
      sql: `INSERT INTO split_exercises (id, split_day_id, exercise_id, position, set_type, target_sets, target_reps, target_rpe)
            VALUES (1, ?, 'bench-press', 0, 'weight_reps', 3, 8, 7)`,
      args: [splitDayId],
    })
    await sessions.startSession('user-1', {
      id: 'session-1',
      splitDayId,
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetReps: 8, targetRpe: 7 }],
    })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: 7 })

    await service.completeSession('session-1', 1)
    expect(onSessionCompleted).toHaveBeenCalledTimes(1)

    const completed = await sessions.findSessionById('session-1')
    expect(completed?.status).toBe('completed')
  })

  it('excludes rest days from scheduledDaysThisWeek', async () => {
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const blocks = new BlockRepository(db)
    await blocks.createWithDays('user-1', {
      programId: null,
      name: 'Block',
      startDate: '2020-01-01',
      endDate: null,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: [
        { name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [] },
        { name: 'Pull', dayOfWeek: 1, location: 'gym', exercises: [] },
        { name: 'Rest', dayOfWeek: 2, location: 'home', isRestDay: true, exercises: [] },
      ],
    })
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })

    await service.completeSession('session-1', 1)

    const [, , facts] = onSessionCompleted.mock.calls[0]
    expect(facts.scheduledDaysThisWeek).toBe(2)
  })

  it('never calls GamificationService.onSessionCompleted when completion conflicts on a stale version', async () => {
    await seedUserWithActiveBlock(db, 1)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })

    await service.completeSession('session-1', 1)
    onSessionCompleted.mockClear()

    const result = await service.completeSession('session-1', 1)

    expect(result.conflict).toBe(true)
    expect(onSessionCompleted).not.toHaveBeenCalled()
  })

  it('reports zero scheduled days when the user has no active block, without treating it as a missed day', async () => {
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })

    await service.completeSession('session-1', 1)

    expect(onSessionCompleted).toHaveBeenCalledTimes(1)
    const [, , facts] = onSessionCompleted.mock.calls[0]
    expect(facts.scheduledDaysThisWeek).toBe(0)
    expect(facts.completedDaysThisWeek).toBe(1)
    expect(facts.missedScheduledDay).toBe(false)
  })

  it('still returns the completion result when GamificationService.onSessionCompleted throws', async () => {
    await seedUserWithActiveBlock(db, 1)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })

    onSessionCompleted.mockRejectedValueOnce(new Error('gamification blew up'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await service.completeSession('session-1', 1)

    expect(result.conflict).toBe(false)
    if (!result.conflict) {
      expect(result.session.status).toBe('completed')
    }
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('summarizes the session: total volume excludes warm-ups, and prsHit surfaces PRs recorded for this session\'s sets', async () => {
    await seedUserWithActiveBlock(db, 1)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')" })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    // A warm-up (40kg x 10) that must not count toward volume, plus a real working set (100kg x
    // 5) that a prior set-logging call would have flagged as a PR — simulated here the same way
    // sets.post.ts records one: an xp_ledger('pr') entry keyed by the set's id.
    await sessions.logSet({ id: 'set-warmup', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 40, reps: 10, rpe: null, isWarmup: true })
    await sessions.logSet({ id: 'set-working', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 100, reps: 5, rpe: 8, isWarmup: false })
    await xp.award('user-1', 50, 'pr', 'set-working')

    const result = await service.completeSession('session-1', 1)

    expect(result.conflict).toBe(false)
    if (result.conflict) return
    expect(result.summary.totalVolumeKg).toBe(100 * 5)
    expect(result.summary.prsHit).toEqual([{ exerciseName: 'Bench Press', weightKg: 100, reps: 5 }])
    expect(result.summary.durationMinutes).toBeGreaterThanOrEqual(0)
    expect(result.summary.currentStreak).toBe((await streaks.findForUser('user-1')).currentStreak)
  })
})
