import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

function ctx(userId = 'user-1'): RequestContext {
  return { userId, roles: [], permissions: [] }
}

describe('WorkoutsService', () => {
  let db: Client
  let sessions: SessionRepository
  let blocks: BlockRepository
  let xp: XpRepository
  let service: WorkoutsService

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    blocks = new BlockRepository(db)
    xp = new XpRepository(db)
    service = new WorkoutsService(ctx(), sessions, blocks, new ExerciseRepository(db), xp)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('squat', 'Squat', '[]')" })
  })

  it('returns null todaysWorkout when there is no active block', async () => {
    const summary = await service.getSummary()
    expect(summary.todaysWorkout).toBeNull()
    expect(summary.activeSession).toBeNull()
    expect(summary.recentSessions).toEqual([])
  })

  it('returns the next unstarted day as todaysWorkout, with split-exercise metadata', async () => {
    await blocks.createWithDays('user-1', {
      programId: null,
      name: 'Block',
      startDate: '2020-01-01',
      endDate: null,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: [
        { name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [
          { exerciseId: 'squat', position: 0, setType: 'weight_reps', targetSets: 3, targetReps: 5, targetRpe: 8 },
        ] },
      ],
    })

    const summary = await service.getSummary()

    expect(summary.todaysWorkout?.dayName).toBe('Push')
    expect(summary.todaysWorkout?.exercises[0]).toMatchObject({
      exerciseId: 'squat',
      setType: 'weight_reps',
      targetSets: 3,
    })
  })

  it('includes an in-progress session as activeSession', async () => {
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })

    const summary = await service.getSummary()

    expect(summary.activeSession?.sessionId).toBe('session-1')
  })

  it('surfaces a completed session and its PR in recentSessions/recentPrs', async () => {
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 100, reps: 5, rpe: 8 })
    await sessions.completeSession('session-1', 1)
    await xp.award('user-1', 50, 'pr', 'set-1')

    const summary = await service.getSummary()

    expect(summary.recentSessions).toHaveLength(1)
    expect(summary.recentSessions[0]).toMatchObject({ sessionId: 'session-1', topWeightKg: 100, topReps: 5 })
    expect(summary.recentPrs).toHaveLength(1)
    expect(summary.recentPrs[0]).toMatchObject({ exerciseName: 'Squat', weightKg: 100, reps: 5 })
  })
})
