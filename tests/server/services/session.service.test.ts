import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
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
  let service: SessionService
  let onSessionCompleted: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    onSessionCompleted = vi.fn()
    service = new SessionService(ctx(), sessions, new BlockRepository(db), { onSessionCompleted } as never)
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
    // A mid-week completion (1 of 2 scheduled days done) must never be reported as a
    // missed day — missedScheduledDay is a fact about a closed week, not an open one.
    expect(facts.missedScheduledDay).toBe(false)
  })

  it('never calls GamificationService.onSessionCompleted when completion conflicts on a stale version', async () => {
    await seedUserWithActiveBlock(db, 1)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('plank', 'Plank', '[]')" })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'plank', position: 0, setType: 'time' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: null, reps: null, rpe: null })

    // First completion succeeds and bumps the version to 2.
    await service.completeSession('session-1', 1)
    onSessionCompleted.mockClear()

    // A stale client retries with the old expected version and hits the conflict branch.
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
})
