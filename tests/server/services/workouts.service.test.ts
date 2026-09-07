import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { MuscleRepository } from '~~/server/repositories/muscle.repository'
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

  it('enriches todaysWorkout exercises with catalog details and last-performed history', async () => {
    const muscles = new MuscleRepository(db)
    const chest = await muscles.getOrCreate('chest')
    await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: ['squat', chest.id, 'primary'] })
    await db.execute({ sql: 'INSERT INTO exercise_images (exercise_id, url, position) VALUES (?, ?, ?)', args: ['squat', 'squat.jpg', 0] })

    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
    await sessions.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 120, reps: 5, rpe: 8 })
    await sessions.completeSession('session-1', 1)

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
    const exercise = summary.todaysWorkout?.exercises[0]

    expect(exercise?.thumbnailUrl).toBe('squat.jpg')
    expect(exercise?.primaryMuscle).toBe('chest')
    expect(exercise?.lastPerformed).toEqual({ weightKg: 120, reps: 5, date: exercise?.lastPerformed?.date })
  })

  it('leaves lastPerformed null for an exercise with no logged history', async () => {
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

    expect(summary.todaysWorkout?.exercises[0]?.lastPerformed).toBeNull()
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

  describe('getWeeklyVolume', () => {
    let exerciseLogId: string

    beforeEach(async () => {
      const muscles = new MuscleRepository(db)
      const chest = await muscles.getOrCreate('chest')
      await db.execute({ sql: 'INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)', args: ['squat', chest.id, 'primary'] })
      await sessions.startSession('user-1', { id: 'volume-session', splitDayId: null, exercises: [] })
      await sessions.addFreeformExercise({ id: 'volume-exlog', sessionId: 'volume-session', exerciseId: 'squat', position: 0, setType: 'weight_reps' })
      exerciseLogId = 'volume-exlog'
    })

    const logSets = async (count: number): Promise<void> => {
      for (let setNumber = 1; setNumber <= count; setNumber++) {
        await sessions.logSet({ id: `volume-set-${setNumber}`, exerciseLogId, setNumber, weightKg: 50, reps: 8, rpe: 7 })
      }
    }

    it('bands 9 sets as low (below the low threshold)', async () => {
      await logSets(9)
      const result = await service.getWeeklyVolume('user-1')
      expect(result).toEqual([{ muscleName: 'chest', setCount: 9, band: 'low' }])
    })

    it('bands 10 sets as optimal (low threshold boundary)', async () => {
      await logSets(10)
      const result = await service.getWeeklyVolume('user-1')
      expect(result).toEqual([{ muscleName: 'chest', setCount: 10, band: 'optimal' }])
    })

    it('bands 22 sets as optimal (high threshold boundary)', async () => {
      await logSets(22)
      const result = await service.getWeeklyVolume('user-1')
      expect(result).toEqual([{ muscleName: 'chest', setCount: 22, band: 'optimal' }])
    })

    it('bands 23 sets as high (above the high threshold)', async () => {
      await logSets(23)
      const result = await service.getWeeklyVolume('user-1')
      expect(result).toEqual([{ muscleName: 'chest', setCount: 23, band: 'high' }])
    })
  })
})
