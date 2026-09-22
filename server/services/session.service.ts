import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { BaseService } from '~~/server/services/base.service'
import type { ConflictResult, EditSetLogInput, InsertPastSessionInput, LogSetInput, SessionRepository, SetLogEditResult, StartSessionExerciseInput, StartSessionInput } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'
import { repRangeArgs } from '~~/server/repositories/rep-range-columns'
import type { GamificationService } from '~~/server/services/gamification.service'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { PastSessionInput, PastSessionResult, SessionCompletionSummary, SetLog, WorkoutSession } from '~~/shared/types/session.types'
import { detectPersonalRecords } from '~~/shared/lib/personal-records'
import { pastSessionTimestamps, validatePastSession } from '~~/shared/lib/past-session'
import { suggestProgression } from '~~/shared/lib/progression'
import { toSqliteDatetime, fromSqliteDatetime } from '~~/server/utils/date'

// How many recent sessions of an exercise the progression rules look at (the back-off rule needs
// the previous two).
const PROGRESSION_LOOKBACK_SESSIONS = 2

export class SessionService extends BaseService {
  constructor(
    ctx: RequestContext,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
    private gamification: GamificationService,
    // Records PRs at log time and reads them back for the post-workout summary; separate from
    // `gamification`, which owns XP and the derived streak the summary also shows.
    private personalRecords: PersonalRecordRepository,
    // Optional: only the routes that need progression suggestions wire these up, so routes that
    // just complete a session don't have to construct repositories they never use.
    private deps: { exercises?: ExerciseRepository, profiles?: ProfileRepository } = {},
  ) {
    super(ctx)
  }

  async startSession(input: StartSessionInput): Promise<WorkoutSession> {
    await this.sessions.expireStaleSessions(this.ctx.userId)
    const exercises = await this.withSuggestions(input.exercises)
    return this.sessions.startSession(this.ctx.userId, { ...input, exercises })
  }

  // Never blocks starting a workout: if anything about computing suggestions fails, the exercises
  // are attached with no suggestion and the UI simply doesn't show one.
  private async withSuggestions(exercises: StartSessionExerciseInput[]): Promise<StartSessionExerciseInput[]> {
    const { exercises: exerciseRepo, profiles } = this.deps
    if (!exerciseRepo || !profiles || exercises.length === 0) return exercises

    try {
      const [catalog, profile] = await Promise.all([
        exerciseRepo.findByIds([...new Set(exercises.map(e => e.exerciseId))]),
        profiles.findByUserId(this.ctx.userId),
      ])
      const byId = new Map(catalog.map(e => [e.id, e]))
      const unitSystem = profile?.unitSystem ?? 'metric'

      return await Promise.all(exercises.map(async (exercise) => {
        const recentSessions = await this.sessions.findRecentWorkingSets(this.ctx.userId, exercise.exerciseId, PROGRESSION_LOOKBACK_SESSIONS)
        const meta = byId.get(exercise.exerciseId)
        // Same rep-range resolution the repository writes to the columns, so a suggestion made for
        // an older build's single targetReps matches the targets stored alongside it.
        const [, repsMin, repsMax] = repRangeArgs(exercise)
        const suggestion = suggestProgression({
          prescription: { sets: exercise.targetSets, repsMin, repsMax, rpe: exercise.targetRpe },
          recentSessions,
          setType: exercise.setType,
          equipment: meta?.equipment ?? null,
          movementPattern: meta?.movementPattern ?? null,
          unitSystem,
        })
        return { ...exercise, suggestion }
      }))
    } catch (error) {
      console.error('SessionService.withSuggestions failed; starting session without suggestions', { error })
      return exercises
    }
  }

  private async requireOwnedSession(sessionId: string) {
    const session = await this.sessions.findSessionById(sessionId)
    if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
    this.requireOwner(session.userId)
    return session
  }

  private async requireOwnedExerciseLog(exerciseLogId: string) {
    const ownerId = await this.sessions.findExerciseLogOwnerId(exerciseLogId)
    if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Exercise log not found' })
    this.requireOwner(ownerId)
  }

  private async requireOwnedSet(setLogId: string) {
    const ownerId = await this.sessions.findSetLogOwnerId(setLogId)
    if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Set log not found' })
    this.requireOwner(ownerId)
  }

  // Rewards and PR detection never block logging: the set is already durably stored by the time
  // they run, and a failure there shouldn't fail the request mid-workout.
  async logSet(input: LogSetInput): Promise<SetLog> {
    await this.requireOwnedExerciseLog(input.exerciseLogId)
    const { setLog, alreadyLogged } = await this.sessions.logSet(input)
    try {
      await this.gamification.onSetLogged(this.ctx.userId, setLog.id)
      const exerciseId = await this.sessions.findExerciseIdForLog(setLog.exerciseLogId)
      await this.recordPersonalRecords(setLog, exerciseId)
      if (exerciseId && this.mayHaveLandedOutOfOrder(input, alreadyLogged)) {
        await this.redetectLaterPersonalRecords(exerciseId, setLog.id)
      }
    } catch (error) {
      console.error('SessionService.logSet: rewards/PR detection failed after set logged', { setLogId: setLog.id, error })
    }
    return setLog
  }

  /**
   * Whether this set is worth probing for later sets whose baseline it just joined. The probe
   * itself is a query, and the mid-workout case -- a set logged after everything else -- has
   * nothing to find, so three checks that cost nothing rule it out first:
   *
   * - a replay stored no new row, so the ordering is exactly what the first delivery already swept
   * - a warm-up is filtered out of every PR baseline, so it changes no other set's verdict
   * - with no client timestamp the row is stamped `datetime('now')` and takes the highest rowid,
   *   and nothing can be stored above now, so it sorts last by construction
   *
   * Past those, the probe is `findWorkingSetsAfter` itself: any cheaper test needs the same
   * indexed lookup, and reusing it means a genuinely backdated set doesn't pay for it twice.
   */
  private mayHaveLandedOutOfOrder(input: LogSetInput, alreadyLogged: boolean): boolean {
    return !alreadyLogged && !input.isWarmup && Boolean(input.loggedAt)
  }

  // A correction can turn a PR into a non-PR (or the reverse), so the set's PRs are torn down and
  // re-detected against the same "everything logged before it" baseline. The set XP stays: the set
  // itself was still performed.
  async editSet(setLogId: string, expectedVersion: number, corrections: EditSetLogInput): Promise<SetLogEditResult | ConflictResult> {
    await this.requireOwnedSet(setLogId)
    const result = await this.sessions.editSetLog(setLogId, expectedVersion, corrections)
    if (result.conflict) return result
    // A replayed edit changed nothing, so the PRs derived from this set are already correct.
    // Re-deriving them would tear down and rebuild identical rows, leaving a window where the
    // set's PR is briefly missing from a concurrent read -- and replays are exactly what the
    // offline outbox produces.
    if (result.alreadyApplied) return result
    try {
      const exerciseId = await this.sessions.findExerciseIdForLog(result.setLog.exerciseLogId)
      await this.personalRecords.deleteForSet(setLogId)
      await this.gamification.revokeSetRewards(this.ctx.userId, setLogId, { includeSetXp: false })
      // The corrected set first, so the later sets are judged against the baseline it now sets.
      await this.recordPersonalRecords(result.setLog, exerciseId)
      if (exerciseId) await this.redetectLaterPersonalRecords(exerciseId, setLogId)
    } catch (error) {
      console.error('SessionService.editSet: PR re-detection failed after set edited', { setLogId, error })
    }
    return result
  }

  /**
   * Every set's PR verdict is judged against the working sets logged before it, so a set that
   * joins or changes that baseline -- a correction, a backdated workout, an offline set arriving
   * after a later one already synced -- leaves every later set of the same exercise holding a
   * stale verdict. Tear those down and re-detect them in (logged_at, rowid) order. The set XP
   * stays: those sets were still performed, only their PR bonus is re-decided.
   */
  private async redetectLaterPersonalRecords(exerciseId: string, setLogId: string): Promise<void> {
    const userId = this.ctx.userId
    for (const later of await this.sessions.findWorkingSetsAfter(userId, exerciseId, setLogId)) {
      await this.personalRecords.deleteForSet(later.id)
      await this.gamification.revokeSetRewards(userId, later.id, { includeSetXp: false })
      await this.recordPersonalRecords(later, exerciseId)
    }
  }

  // Unlike logSet, the reward teardown is *not* swallowed: leaving XP or a PR behind for a set
  // that no longer exists is worse than failing the delete, which the client can retry.
  async deleteSet(setLogId: string): Promise<void> {
    await this.requireOwnedSet(setLogId)
    await this.personalRecords.deleteForSet(setLogId)
    await this.gamification.revokeSetRewards(this.ctx.userId, setLogId, { includeSetXp: true })
    await this.sessions.deleteSetLog(setLogId)
  }

  // exerciseId is passed in by the callers that already resolved it -- they need it for the
  // later-set sweep anyway -- so the lookup isn't repeated for every set of a past session.
  private async recordPersonalRecords(setLog: SetLog, knownExerciseId?: string | null): Promise<void> {
    const exerciseId = knownExerciseId ?? await this.sessions.findExerciseIdForLog(setLog.exerciseLogId)
    if (!exerciseId) return
    const prior = await this.sessions.findWorkingSetsBefore(this.ctx.userId, exerciseId, setLog.id)
    const prs = detectPersonalRecords(setLog, prior)
    if (prs.length === 0) return
    await this.personalRecords.insertMany({ userId: this.ctx.userId, exerciseId, setLogId: setLog.id, achievedAt: setLog.loggedAt, prs })
    await this.gamification.onPrHit(this.ctx.userId, setLog.id)
  }

  async completeSession(
    sessionId: string,
    expectedVersion: number,
    completedAt: string | null = null,
  ): Promise<{ conflict: true } | { conflict: false, session: WorkoutSession, summary: SessionCompletionSummary }> {
    await this.requireOwnedSession(sessionId)

    const result = await this.sessions.completeSession(sessionId, expectedVersion, completedAt)
    if (result.conflict) return result

    // Nothing to measure here any more: the streak is derived from session history on read, so
    // gamification only needs to know that this session finished. Skipped entirely on a replay of
    // a completion that already applied -- the first call ran it, and the summary below is read
    // back from stored state either way.
    if (!result.alreadyCompleted) {
      try {
        await this.gamification.onSessionCompleted(this.ctx.userId, sessionId)
      } catch (error) {
        console.error('GamificationService.onSessionCompleted failed after session completion', { sessionId, error })
      }
    }

    const [totalVolumeKg, prsHit, streak] = await Promise.all([
      this.sessions.sessionVolumeKg(sessionId),
      this.personalRecords.findForSession(this.ctx.userId, sessionId),
      this.gamification.getStreak(this.ctx.userId),
    ])

    // completedAt is guaranteed set: this branch is only reached when the completeSession update
    // above actually applied (result.conflict === false), which sets it in the same statement.
    // It may be the lifter's own offline clock, but the repository clamped it to at least
    // started_at, so the duration can't come out negative.
    const durationMinutes = result.session.completedAt
      ? Math.max(0, Math.round(
          (fromSqliteDatetime(result.session.completedAt).getTime() - fromSqliteDatetime(result.session.startedAt).getTime()) / 60000,
        ))
      : 0

    return {
      conflict: false,
      session: result.session,
      summary: { totalVolumeKg, durationMinutes, prsHit, currentStreak: streak.current },
    }
  }

  async logPastSession(input: PastSessionInput, now = new Date()): Promise<PastSessionResult> {
    const invalid = validatePastSession(input, now)
    if (invalid) throw createError({ statusCode: 422, statusMessage: invalid })

    // A retried save returns what the first one wrote, and never re-runs rewards.
    const existing = await this.sessions.findSessionById(input.id)
    if (existing) {
      this.requireOwner(existing.userId)
      return { sessionId: existing.id, prsHit: await this.personalRecords.findForSession(this.ctx.userId, existing.id) }
    }

    if (input.splitDayId !== null) {
      const ownerId = await this.blocks.findSplitDayOwnerId(input.splitDayId)
      if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Split day not found' })
      this.requireOwner(ownerId)
    }

    const totalSets = input.exercises.reduce((sum, exercise) => sum + exercise.sets, 0)
    const times = pastSessionTimestamps(new Date(input.startedAt), totalSets, now)
    let setIndex = 0
    const exercises: InsertPastSessionInput['exercises'] = input.exercises.map((exercise, position) => ({
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      splitExerciseId: exercise.splitExerciseId,
      position,
      setType: exercise.setType,
      targetSets: exercise.targetSets,
      targetRepsMin: exercise.targetRepsMin,
      targetRepsMax: exercise.targetRepsMax,
      targetRpe: exercise.targetRpe,
      sets: Array.from({ length: exercise.sets }, (_, i) => ({
        id: randomUUID(),
        setNumber: i + 1,
        weightKg: exercise.setType === 'weight_reps' ? exercise.weightKg : null,
        reps: exercise.setType === 'time' ? null : exercise.reps,
        loggedAt: toSqliteDatetime(times.setTimes[setIndex++]!),
      })),
    }))

    await this.sessions.insertPastSession(this.ctx.userId, {
      id: input.id,
      splitDayId: input.splitDayId,
      startedAt: toSqliteDatetime(times.startedAt),
      completedAt: toSqliteDatetime(times.completedAt),
      exercises,
    })

    // Same rule as logSet: the workout is durably stored, so a reward failure is logged, not surfaced.
    try {
      await this.rewardPastSession(input.id, exercises)
    } catch (error) {
      console.error('SessionService.logPastSession: rewards failed after past session stored', { sessionId: input.id, error })
    }

    return { sessionId: input.id, prsHit: await this.personalRecords.findForSession(this.ctx.userId, input.id) }
  }

  private async rewardPastSession(sessionId: string, exercises: InsertPastSessionInput['exercises']): Promise<void> {
    const userId = this.ctx.userId
    for (const exercise of exercises) {
      for (const set of exercise.sets) {
        await this.gamification.onSetLogged(userId, set.id)
        await this.recordPersonalRecords({ ...set, exerciseLogId: exercise.id, rpe: null, isWarmup: false, version: 1 }, exercise.exerciseId)
      }
    }

    // The backdated sets joined the baseline of everything logged after them. Sweeping from the
    // exercise's last set covers the lot: the earlier ones are followed by sets of this same
    // session, which were just detected in order above.
    for (const exercise of exercises) {
      const lastSet = exercise.sets.at(-1)
      if (!lastSet) continue
      await this.redetectLaterPersonalRecords(exercise.exerciseId, lastSet.id)
    }

    await this.gamification.onPastSessionLogged(userId, sessionId)
  }
}
