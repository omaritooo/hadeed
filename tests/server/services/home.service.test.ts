import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'
import { GamificationService } from '~~/server/services/gamification.service'
import { WorkoutsService } from '~~/server/services/workouts.service'
import { HomeService } from '~~/server/services/home.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

function ctx(userId = 'user-1'): RequestContext {
  return { userId, roles: [], permissions: [] }
}

describe('HomeService', () => {
  let db: Client
  let sessions: SessionRepository
  let blocks: BlockRepository
  let prs: PersonalRecordRepository
  let service: HomeService

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    blocks = new BlockRepository(db)
    prs = new PersonalRecordRepository(db)
    const exercises = new ExerciseRepository(db)
    const xp = new XpRepository(db)
    const workouts = new WorkoutsService(ctx(), sessions, blocks, exercises, prs)
    const achievements = new AchievementRepository(db)
    const gamification = new GamificationService(xp, achievements, sessions, blocks)
    service = new HomeService(ctx(), sessions, blocks, gamification, xp, prs, achievements, new BodyMetricsRepository(db), workouts)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('squat', 'Squat', '[]')" })
  })

  it('returns a summary with null todaysWorkout/activeSession when there is no active block', async () => {
    const summary = await service.getSummary()
    expect(summary.todaysWorkout).toBeNull()
    expect(summary.activeSession).toBeNull()
    expect(summary.streak).toEqual({ current: 0, longest: 0, thisWeek: { completed: 0, required: 0, scheduled: 0 } })
  })

  it('threads a real active block/split day through to todaysWorkout via the delegated WorkoutsService call', async () => {
    await blocks.createWithDays('user-1', {
      programId: null,
      name: 'Block',
      startDate: '2020-01-01',
      endDate: null,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: [
        { name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [
          { exerciseId: 'squat', position: 0, setType: 'weight_reps', targetSets: 3, targetRepsMin: 5, targetRepsMax: 5, targetRpe: 8 },
        ] },
      ],
    })

    const summary = await service.getSummary()

    expect(summary.todaysWorkout?.dayName).toBe('Push')
    expect(summary.todaysWorkout?.exercises[0]).toMatchObject({
      exerciseId: 'squat',
      exerciseName: 'Squat',
      setType: 'weight_reps',
      targetSets: 3,
    })
  })

  it('threads a real in-progress session through to activeSession via the delegated WorkoutsService call', async () => {
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 100, reps: 5, rpe: 8 })

    const summary = await service.getSummary()

    expect(summary.activeSession).toMatchObject({ sessionId: 'session-1', setsLogged: 1 })
  })

  it('surfaces recorded personal records in recentPrs, with their PR types', async () => {
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 100, reps: 5, rpe: 8 })
    await prs.insertMany({
      userId: 'user-1',
      exerciseId: 'squat',
      setLogId: 'set-1',
      achievedAt: '2026-01-01 10:00:00',
      prs: [{ type: 'weight', value: 100, previousValue: 95 }],
    })

    const summary = await service.getSummary()

    expect(summary.recentPrs).toEqual([
      { exerciseName: 'Squat', weightKg: 100, reps: 5, prTypes: ['weight'], e1rmKg: null, achievedAt: '2026-01-01 10:00:00' },
    ])
  })
})
