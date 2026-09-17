import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'
import { GamificationService } from '~~/server/services/gamification.service'
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
      sql: `INSERT INTO split_exercises (id, split_day_id, exercise_id, position, set_type, target_sets, target_reps_min, target_reps_max, target_rpe)
            VALUES (1, ?, 'bench-press', 0, 'weight_reps', 3, 8, 8, 7)`,
      args: [splitDayId],
    })
    await sessions.startSession('user-1', {
      id: 'session-1',
      splitDayId,
      exercises: [{ id: 'exlog-1', exerciseId: 'bench-press', splitExerciseId: 1, position: 0, setType: 'weight_reps', targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 7 }],
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
    expect(result.summary.prsHit).toEqual([{ exerciseName: 'Bench Press', weightKg: 100, reps: 5, prTypes: ['weight'], e1rmKg: null }])
    expect(result.summary.durationMinutes).toBeGreaterThanOrEqual(0)
    expect(result.summary.currentStreak).toBe((await streaks.findForUser('user-1')).currentStreak)
  })
})

describe('SessionService.startSession', () => {
  let db: Client
  let sessions: SessionRepository
  let service: SessionService

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, equipment, movement_pattern, instructions) VALUES ('bench-press', 'Bench Press', 'barbell', 'horizontal_push', '[]')`)
    service = new SessionService(ctx(), sessions, new BlockRepository(db), {} as never, new XpRepository(db), new StreakRepository(db), {
      exercises: new ExerciseRepository(db),
      profiles: new ProfileRepository(db),
    })
  })

  const exercise = (id: string) => ({
    id,
    exerciseId: 'bench-press',
    splitExerciseId: null,
    position: 0,
    setType: 'weight_reps' as const,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetRpe: null,
  })

  it('snapshots first_time for an exercise with no history', async () => {
    await service.startSession({ id: 's1', splitDayId: null, exercises: [exercise('e1')] })

    expect((await sessions.findWithLogs('s1'))!.exercises[0]!.suggestion?.action).toBe('first_time')
  })

  it('snapshots an increase after a session at the top of the range', async () => {
    await service.startSession({ id: 's1', splitDayId: null, exercises: [exercise('e1')] })
    for (const n of [1, 2, 3]) {
      await sessions.logSet({ id: `set-${n}`, exerciseLogId: 'e1', setNumber: n, weightKg: 60, reps: 10, rpe: null })
    }
    await sessions.completeSession('s1', 1)

    await service.startSession({ id: 's2', splitDayId: null, exercises: [exercise('e2')] })

    expect((await sessions.findWithLogs('s2'))!.exercises[0]!.suggestion).toMatchObject({ action: 'increase', weightKg: 62.5 })
  })

  it('falls back to the legacy targetReps payload older app builds send', async () => {
    await service.startSession({
      id: 's1',
      splitDayId: null,
      exercises: [{ ...exercise('e1'), targetRepsMin: null, targetRepsMax: null, targetReps: 8 } as never],
    })

    expect((await sessions.findWithLogs('s1'))!.exercises[0]!.suggestion).toMatchObject({ action: 'first_time', repsMin: 8, repsMax: 8 })
  })

  it('still starts the session when loading history throws', async () => {
    vi.spyOn(sessions, 'findRecentWorkingSets').mockRejectedValueOnce(new Error('db down'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await service.startSession({ id: 's1', splitDayId: null, exercises: [exercise('e1')] })

    expect((await sessions.findWithLogs('s1'))!.exercises[0]!.suggestion).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

describe('SessionService set logging', () => {
  let db: Client
  let sessions: SessionRepository
  let xp: XpRepository
  let prs: PersonalRecordRepository
  let service: SessionService

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    xp = new XpRepository(db)
    prs = new PersonalRecordRepository(db)
    const streaks = new StreakRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`)
    const gamification = new GamificationService(xp, streaks, new AchievementRepository(db), sessions)
    service = new SessionService(ctx(), sessions, new BlockRepository(db), gamification, xp, streaks, { personalRecords: prs })
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
  })

  const log = (id: string, weightKg: number, reps: number) =>
    service.logSet({ id, exerciseLogId: 'e1', setNumber: 1, weightKg, reps, rpe: null })

  it('awards 10 XP per set', async () => {
    await log('set-1', 60, 8)
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(1)
  })

  it('does not treat a first-ever set as a PR', async () => {
    await log('set-1', 60, 8)
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
  })

  it('records PR types and awards the PR bonus once per set', async () => {
    await log('set-1', 60, 8)
    await log('set-2', 65, 8)
    expect((await prs.findForSession('user-1', 's1'))[0]!.prTypes).toEqual(['e1rm', 'weight'])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(1)
  })

  it('revokes set and PR XP when the set is deleted', async () => {
    await log('set-1', 60, 8)
    await log('set-2', 65, 8)
    await service.deleteSet('set-2')
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(1)
    expect(await prs.findForSession('user-1', 's1')).toEqual([])
  })

  it('re-detects PRs when a set is edited', async () => {
    await log('set-1', 60, 8)
    const pr = await log('set-2', 65, 8)
    await service.editSet(pr.id, pr.version, { weightKg: 55 })
    expect(await prs.findForSession('user-1', 's1')).toEqual([])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
  })

  it('rejects logging to someone else\'s exercise log', async () => {
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    const other = new SessionService(ctx('user-2'), sessions, new BlockRepository(db), {} as never, xp, new StreakRepository(db), { personalRecords: prs })
    await expect(other.logSet({ id: 'x', exerciseLogId: 'e1', setNumber: 1, weightKg: 1, reps: 1, rpe: null })).rejects.toThrow(/forbidden/i)
  })
})
