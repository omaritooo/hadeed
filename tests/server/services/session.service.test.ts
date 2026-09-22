import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'
import { GamificationService } from '~~/server/services/gamification.service'
import { SessionService } from '~~/server/services/session.service'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { PastSessionInput } from '~~/shared/types/session.types'
import { toSqliteDatetime } from '~~/server/utils/date'

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
  let prs: PersonalRecordRepository
  let service: SessionService
  let onSessionCompleted: ReturnType<typeof vi.fn>
  let getStreak: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    prs = new PersonalRecordRepository(db)
    onSessionCompleted = vi.fn()
    getStreak = vi.fn().mockResolvedValue({ current: 3, longest: 5, thisWeek: { completed: 1, required: 2, scheduled: 3 } })
    service = new SessionService(ctx(), sessions, new BlockRepository(db), { onSessionCompleted, getStreak } as never, prs)
  })

  it('rejects completing a session owned by someone else', async () => {
    await seedUserWithActiveBlock(db, 1)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    await sessions.startSession('user-2', { id: 'session-1', splitDayId: null, exercises: [] })

    await expect(service.completeSession('session-1', 1)).rejects.toThrow(/forbidden/i)
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

  it('calls onSessionCompleted with just the user and session', async () => {
    await seedUserWithActiveBlock(db, 1)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await service.completeSession('session-1', 1)
    expect(onSessionCompleted).toHaveBeenCalledWith('user-1', 'session-1')
  })

  // The lifter's phone never saw the first response, so it retries the finish. The workout is
  // already banked: hand back the same session and summary, and don't pay the rewards twice.
  it('returns the summary without re-running gamification when the session was already completed', async () => {
    await seedUserWithActiveBlock(db, 1)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await service.completeSession('session-1', 1)
    onSessionCompleted.mockClear()

    const result = await service.completeSession('session-1', 1)

    expect(result.conflict).toBe(false)
    if (result.conflict) return
    expect(result.session.status).toBe('completed')
    expect(result.summary.currentStreak).toBe(3)
    expect(onSessionCompleted).not.toHaveBeenCalled()
  })

  it('still conflicts for an abandoned session', async () => {
    await seedUserWithActiveBlock(db, 1)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute(`UPDATE workout_sessions SET status = 'abandoned', version = 2 WHERE id = 'session-1'`)

    const result = await service.completeSession('session-1', 1)

    expect(result.conflict).toBe(true)
    expect(onSessionCompleted).not.toHaveBeenCalled()
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
    // SessionService.logSet records one: a personal_records row keyed by the set's id.
    await sessions.logSet({ id: 'set-warmup', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 40, reps: 10, rpe: null, isWarmup: true })
    await sessions.logSet({ id: 'set-working', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 100, reps: 5, rpe: 8, isWarmup: false })
    await prs.insertMany({
      userId: 'user-1',
      exerciseId: 'bench-press',
      setLogId: 'set-working',
      achievedAt: '2026-01-01 10:00:00',
      prs: [{ type: 'weight', value: 100, previousValue: 95 }],
    })

    const result = await service.completeSession('session-1', 1)

    expect(result.conflict).toBe(false)
    if (result.conflict) return
    expect(result.summary.totalVolumeKg).toBe(100 * 5)
    expect(result.summary.prsHit).toEqual([{ exerciseName: 'Bench Press', weightKg: 100, reps: 5, prTypes: ['weight'], e1rmKg: null }])
    expect(result.summary.durationMinutes).toBeGreaterThanOrEqual(0)
    expect(result.summary.currentStreak).toBe(3)
  })

  // A session finished offline and synced later must be measured from when the lifter actually
  // stopped, not from when the outbox drained.
  it('measures the duration from a client completedAt rather than the sync time', async () => {
    await seedUserWithActiveBlock(db, 1)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute(`UPDATE workout_sessions SET started_at = '2026-09-14 10:00:00' WHERE id = 'session-1'`)

    const result = await service.completeSession('session-1', 1, '2026-09-14 11:05:00')

    expect(result.conflict).toBe(false)
    if (result.conflict) return
    expect(result.session.completedAt).toBe('2026-09-14 11:05:00')
    expect(result.summary.durationMinutes).toBe(65)
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
    service = new SessionService(ctx(), sessions, new BlockRepository(db), {} as never, new PersonalRecordRepository(db), {
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
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`)
    const gamification = new GamificationService(xp, new AchievementRepository(db), sessions, new BlockRepository(db))
    service = new SessionService(ctx(), sessions, new BlockRepository(db), gamification, prs)
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
    const other = new SessionService(ctx('user-2'), sessions, new BlockRepository(db), {} as never, prs)
    await expect(other.logSet({ id: 'x', exerciseLogId: 'e1', setNumber: 1, weightKg: 1, reps: 1, rpe: null })).rejects.toThrow(/forbidden/i)
  })
})

describe('SessionService replayed completion', () => {
  let db: Client
  let sessions: SessionRepository
  let xp: XpRepository
  let service: SessionService

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    xp = new XpRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const gamification = new GamificationService(xp, new AchievementRepository(db), sessions, new BlockRepository(db))
    service = new SessionService(ctx(), sessions, new BlockRepository(db), gamification, new PersonalRecordRepository(db))
  })

  // Against the real GamificationService, not a mock: the completion bonus must be banked once no
  // matter how many times a flaky connection resends the finish.
  it('awards the session completion bonus exactly once across replays', async () => {
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })

    await service.completeSession('session-1', 1)
    await service.completeSession('session-1', 1)
    await service.completeSession('session-1', 1)

    const ledger = await db.execute({
      sql: `SELECT COUNT(*) AS count FROM xp_ledger WHERE user_id = ? AND source_type = 'session_completed'`,
      args: ['user-1'],
    })
    expect(ledger.rows[0]!.count).toBe(1)
  })

  // A replayed edit changed nothing, so its PR row must survive untouched. Tearing it down and
  // rebuilding it would leave a window where a concurrent read sees no PR for a set that has one.
  it('leaves a replayed edit\'s personal records in place', async () => {
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`)
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'exlog-1', sessionId: 'session-1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await service.logSet({ id: 'set-1', exerciseLogId: 'exlog-1', setNumber: 1, weightKg: 60, reps: 8, rpe: null })
    await service.logSet({ id: 'set-2', exerciseLogId: 'exlog-1', setNumber: 2, weightKg: 80, reps: 8, rpe: null })

    await service.editSet('set-2', 1, { weightKg: 85 })
    const afterEdit = await db.execute({ sql: 'SELECT id, pr_type FROM personal_records WHERE set_log_id = ? ORDER BY pr_type', args: ['set-2'] })
    expect(afterEdit.rows.length).toBeGreaterThan(0)

    const replay = await service.editSet('set-2', 1, { weightKg: 85 })

    expect(replay.conflict).toBe(false)
    const afterReplay = await db.execute({ sql: 'SELECT id, pr_type FROM personal_records WHERE set_log_id = ? ORDER BY pr_type', args: ['set-2'] })
    // Same rows, same ids -- not deleted and reinserted.
    expect(afterReplay.rows).toEqual(afterEdit.rows)
  })
})

describe('SessionService.logPastSession', () => {
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
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`)
    const gamification = new GamificationService(xp, new AchievementRepository(db), sessions, new BlockRepository(db))
    service = new SessionService(ctx(), sessions, new BlockRepository(db), gamification, prs)
  })

  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
  const past = (id: string, weightKg: number, overrides: Partial<PastSessionInput> = {}): PastSessionInput => ({
    id,
    startedAt: daysAgo(3),
    splitDayId: null,
    exercises: [{
      id: `${id}-e1`, exerciseId: 'bench-press', splitExerciseId: null, setType: 'weight_reps',
      targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRpe: null,
      sets: 3, reps: 8, weightKg,
    }],
    ...overrides,
  })

  // A live session today: 60x8, then a 65x8 weight PR.
  const logLiveSession = async () => {
    await sessions.startSession('user-1', { id: 'live', splitDayId: null, exercises: [] })
    await sessions.addFreeformExercise({ id: 'live-e1', sessionId: 'live', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await service.logSet({ id: 'live-1', exerciseLogId: 'live-e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null })
    await service.logSet({ id: 'live-2', exerciseLogId: 'live-e1', setNumber: 2, weightKg: 65, reps: 8, rpe: null })
  }

  it('writes a completed, retroactive session dated to the chosen day', async () => {
    await service.logPastSession(past('p1', 60))

    const session = await sessions.findWithLogs('p1')
    expect(session!.status).toBe('completed')
    expect(session!.loggedRetroactively).toBe(true)
    expect(session!.startedAt.slice(0, 10)).toBe(daysAgo(3).slice(0, 10))
    expect(session!.exercises[0]!.sets).toHaveLength(3)
  })

  it('awards set and session XP', async () => {
    await service.logPastSession(past('p1', 60))
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(3)
    expect(await xp.countBySourceType('user-1', 'session_completed')).toBe(1)
  })

  it('rejects an out-of-window date with 422', async () => {
    await expect(service.logPastSession(past('p1', 60, { startedAt: daysAgo(20) }))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects someone else\'s split day', async () => {
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    await new BlockRepository(db).createWithDays('user-2', {
      programId: null, name: 'Theirs', startDate: '2020-01-01', endDate: null,
      trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [{ name: 'Day', dayOfWeek: 0, location: 'gym', exercises: [] }],
    })
    const day = await db.execute('SELECT id FROM split_days LIMIT 1')

    await expect(service.logPastSession(past('p1', 60, { splitDayId: day.rows[0]!.id as number }))).rejects.toThrow(/forbidden/i)
  })

  it('is idempotent on replay: no duplicate rows or XP', async () => {
    await service.logPastSession(past('p1', 60))
    await service.logPastSession(past('p1', 60))
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(3)
    expect(await xp.countBySourceType('user-1', 'session_completed')).toBe(1)
  })

  it('turns a later PR into a non-PR when a heavier set is backdated before it', async () => {
    await logLiveSession()
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(1)

    await service.logPastSession(past('p1', 70))

    expect(await prs.findForSession('user-1', 'live')).toEqual([])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
  })

  it('keeps later PRs that still beat a lighter backdated set', async () => {
    await logLiveSession()

    await service.logPastSession(past('p1', 50))

    const livePrSets = (await prs.findForSession('user-1', 'live')).map(hit => hit.weightKg)
    expect(livePrSets).toContain(65)
  })
})

// Both bugs are the same shape: a set's PR verdict is judged against everything logged before it,
// so changing what sits *before* a set -- by correcting an earlier one, or by a backdated set
// arriving late -- leaves every later set of that exercise holding a stale verdict.
describe('SessionService PR re-detection around a changed baseline', () => {
  let db: Client
  let sessions: SessionRepository
  let xp: XpRepository
  let prs: PersonalRecordRepository
  let service: SessionService

  const minutesAgo = (minutes: number) => toSqliteDatetime(new Date(Date.now() - minutes * 60_000))

  beforeEach(async () => {
    db = await createTestDb()
    sessions = new SessionRepository(db)
    xp = new XpRepository(db)
    prs = new PersonalRecordRepository(db)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')`)
    const gamification = new GamificationService(xp, new AchievementRepository(db), sessions, new BlockRepository(db))
    service = new SessionService(ctx(), sessions, new BlockRepository(db), gamification, prs)
    await sessions.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    // Opened three hours ago so the clamp accepts every loggedAt the tests below send.
    await db.execute({ sql: 'UPDATE workout_sessions SET started_at = ? WHERE id = ?', args: [minutesAgo(180), 's1'] })
    await sessions.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
  })

  const log = (id: string, weightKg: number, reps: number, minutes: number) =>
    service.logSet({ id, exerciseLogId: 'e1', setNumber: 1, weightKg, reps, rpe: null, loggedAt: minutesAgo(minutes) })

  const prTypesFor = async (setLogId: string) => {
    const result = await db.execute({ sql: 'SELECT pr_type FROM personal_records WHERE set_log_id = ? ORDER BY pr_type', args: [setLogId] })
    return result.rows.map(row => row.pr_type as string)
  }

  // Includes the autoincrement id, so a row that was torn down and rebuilt reads as a different row.
  const prRows = async () => (await db.execute('SELECT id, set_log_id, pr_type FROM personal_records ORDER BY id')).rows

  it('gives a later set the PR it now deserves when an earlier set is edited down', async () => {
    const first = await log('set-1', 100, 8, 120)
    await log('set-2', 80, 8, 60)
    expect(await prTypesFor('set-2')).toEqual([])

    await service.editSet('set-1', first.version, { weightKg: 60 })

    expect(await prTypesFor('set-2')).toEqual(['e1rm', 'weight'])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(1)
    // The sweep revokes the PR bonus only: both sets were still performed.
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(2)
  })

  // Three sets, because deleting the *only* earlier set leaves the later one as the first working
  // set of that exercise, which establishes the baseline rather than scoring against it.
  it('gives a later set the PR it now deserves when the set above it is deleted', async () => {
    await log('set-1', 100, 8, 150)
    await log('set-2', 60, 8, 120)
    await log('set-3', 80, 8, 60)
    // set-1 at 100kg denies set-3 both a weight and an e1RM PR.
    expect(await prTypesFor('set-3')).toEqual([])

    await service.deleteSet('set-1')

    // 80kg now beats everything that remains beneath it.
    expect(await prTypesFor('set-3')).toEqual(['e1rm', 'weight'])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(1)
    // The deleted set loses its own set XP; the two that remain keep theirs.
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(2)
  })

  it('strips a later set\'s PR when the only set beneath it is deleted', async () => {
    await log('set-1', 60, 8, 120)
    await log('set-2', 80, 8, 60)
    expect(await prTypesFor('set-2')).toEqual(['e1rm', 'weight'])

    await service.deleteSet('set-1')

    // set-2 is now the first working set of this exercise, and a first set sets the baseline
    // rather than scoring against it.
    expect(await prTypesFor('set-2')).toEqual([])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
  })

  it('leaves earlier sets alone when the last set is deleted', async () => {
    await log('set-1', 60, 8, 120)
    await log('set-2', 80, 8, 60)
    const before = await prRows()

    await service.deleteSet('set-2')

    // Nothing sorts after set-2, so no row is touched -- set-1 keeps the rows it already had.
    expect(await prRows()).toEqual(before.filter(row => row.set_log_id !== 'set-2'))
  })

  it('strips a later set\'s PR when an earlier set is edited up past it', async () => {
    const first = await log('set-1', 60, 8, 120)
    await log('set-2', 80, 8, 60)
    expect(await prTypesFor('set-2')).toEqual(['e1rm', 'weight'])

    await service.editSet('set-1', first.version, { weightKg: 100 })

    expect(await prTypesFor('set-2')).toEqual([])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(2)
  })

  // An offline session syncing after a later workout already landed from another device.
  it('strips a later set\'s PR when a heavier set arrives out of order beneath it', async () => {
    await log('set-1', 60, 8, 60)
    await log('set-2', 80, 8, 30)
    expect(await prTypesFor('set-2')).toEqual(['e1rm', 'weight'])

    await log('late-arrival', 100, 8, 90)

    expect(await prTypesFor('set-2')).toEqual([])
    expect(await prTypesFor('set-1')).toEqual([])
    expect(await xp.countBySourceType('user-1', 'pr')).toBe(0)
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(3)
  })

  it('leaves later sets\' personal records in place when an out-of-order log is replayed', async () => {
    await log('set-1', 60, 8, 60)
    await log('set-2', 80, 8, 30)
    await log('late-arrival', 50, 8, 90)
    const afterFirstDelivery = await prRows()
    expect(afterFirstDelivery.length).toBeGreaterThan(0)

    await log('late-arrival', 50, 8, 90)

    // Same rows, same ids -- not deleted and reinserted.
    expect(await prRows()).toEqual(afterFirstDelivery)
    expect(await xp.countBySourceType('user-1', 'set_logged')).toBe(3)
  })

  it('leaves later sets\' personal records in place when an edit is replayed', async () => {
    const first = await log('set-1', 100, 8, 120)
    await log('set-2', 80, 8, 60)
    await service.editSet('set-1', first.version, { weightKg: 60 })
    const afterEdit = await prRows()
    expect(afterEdit.length).toBeGreaterThan(0)

    const replay = await service.editSet('set-1', first.version, { weightKg: 60 })

    expect(replay.conflict).toBe(false)
    expect(await prRows()).toEqual(afterEdit)
  })

  // The mid-workout path. Nothing sorts after the new set, so no PR row may be touched -- and the
  // whole path costs one ordering probe and one exercise lookup, not one of each per set touched.
  it('does not tear down any personal record when a set is logged after everything else', async () => {
    await log('set-1', 60, 8, 60)
    await log('set-2', 80, 8, 30)
    const before = await prRows()
    const teardown = vi.spyOn(prs, 'deleteForSet')
    const probe = vi.spyOn(sessions, 'findWorkingSetsAfter')
    const exerciseLookup = vi.spyOn(sessions, 'findExerciseIdForLog')

    await log('set-3', 70, 8, 5)

    expect(teardown).not.toHaveBeenCalled()
    expect(probe).toHaveBeenCalledTimes(1)
    expect(exerciseLookup).toHaveBeenCalledTimes(1)
    expect(await prRows()).toEqual(before)
  })

  // A warm-up is filtered out of every PR baseline, so it can never change another set's verdict
  // -- not even a backdated one, and not even at a weight nothing else comes close to.
  it('does not probe for later sets when the new set is a warm-up', async () => {
    await log('set-1', 60, 8, 60)
    await log('set-2', 80, 8, 30)
    const before = await prRows()
    const probe = vi.spyOn(sessions, 'findWorkingSetsAfter')

    await service.logSet({ id: 'warmup', exerciseLogId: 'e1', setNumber: 3, weightKg: 200, reps: 1, rpe: null, isWarmup: true, loggedAt: minutesAgo(90) })

    expect(probe).not.toHaveBeenCalled()
    expect(await prRows()).toEqual(before)
  })

  // With no client timestamp the row is stamped datetime('now') and takes the highest rowid, so it
  // sorts after every stored set by construction: the probe would always come back empty.
  it('does not probe for later sets when the set carries no client timestamp', async () => {
    await log('set-1', 60, 8, 60)
    await log('set-2', 80, 8, 30)
    const probe = vi.spyOn(sessions, 'findWorkingSetsAfter')

    await service.logSet({ id: 'set-3', exerciseLogId: 'e1', setNumber: 3, weightKg: 70, reps: 8, rpe: null })

    expect(probe).not.toHaveBeenCalled()
  })
})
