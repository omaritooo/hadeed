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
  let service: WorkoutsService

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    blocks = new BlockRepository(db)
    service = new WorkoutsService(ctx(), sessions, blocks, new ExerciseRepository(db), new XpRepository(db))
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
})
