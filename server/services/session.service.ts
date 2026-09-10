import { createError } from 'h3'
import { BaseService } from '~~/server/services/base.service'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { StreakRepository } from '~~/server/repositories/streak.repository'
import type { GamificationService } from '~~/server/services/gamification.service'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { SessionCompletionSummary, WorkoutSession } from '~~/shared/types/session.types'
import { startOfWeek, toSqliteDatetime, fromSqliteDatetime } from '~~/server/utils/date'

export class SessionService extends BaseService {
  constructor(
    ctx: RequestContext,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
    private gamification: GamificationService,
    // Read-only lookups for the post-workout summary (PRs recorded during this session, current
    // streak) — separate from `gamification`, which owns writing/mutating this same state.
    private xp: XpRepository,
    private streaks: StreakRepository,
  ) {
    super(ctx)
  }

  private async requireOwnedSession(sessionId: string) {
    const session = await this.sessions.findSessionById(sessionId)
    if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
    this.requireOwner(session.userId)
    return session
  }

  async completeSession(
    sessionId: string,
    expectedVersion: number,
  ): Promise<{ conflict: true } | { conflict: false, session: WorkoutSession, summary: SessionCompletionSummary }> {
    await this.requireOwnedSession(sessionId)

    const result = await this.sessions.completeSession(sessionId, expectedVersion)
    if (result.conflict) return result

    const now = new Date()
    const weekStart = startOfWeek(now)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7)

    const activeBlock = await this.blocks.findActiveForUser(this.ctx.userId, now.toISOString().slice(0, 10))
    const scheduledDaysThisWeek = activeBlock?.days.filter(day => !day.isRestDay).length ?? 0

    const completedDaysThisWeek = await this.sessions.countTrainedDaysInRange(
      this.ctx.userId,
      toSqliteDatetime(weekStart),
      toSqliteDatetime(weekEnd),
    )

    const missedScheduledDay = false

    try {
      await this.gamification.onSessionCompleted(this.ctx.userId, sessionId, {
        scheduledDaysThisWeek,
        completedDaysThisWeek,
        missedScheduledDay,
      })
    } catch (error) {
      console.error('GamificationService.onSessionCompleted failed after session completion', { sessionId, error })
    }

    // Gathered after the gamification call above so currentStreak reflects any update it just
    // made (e.g. recordActiveDay). If that call threw, this just reports the pre-update streak —
    // consistent with this method's existing swallow-and-log behavior for gamification failures.
    const [totalVolumeKg, prsHit, streak] = await Promise.all([
      this.sessions.sessionVolumeKg(sessionId),
      this.xp.findPrsForSession(this.ctx.userId, sessionId),
      this.streaks.findForUser(this.ctx.userId),
    ])

    // completedAt is guaranteed set: this branch is only reached when the completeSession update
    // above actually applied (result.conflict === false), which sets it in the same statement.
    const durationMinutes = result.session.completedAt
      ? Math.max(0, Math.round(
          (fromSqliteDatetime(result.session.completedAt).getTime() - fromSqliteDatetime(result.session.startedAt).getTime()) / 60000,
        ))
      : 0

    return {
      conflict: false,
      session: result.session,
      summary: { totalVolumeKg, durationMinutes, prsHit, currentStreak: streak.currentStreak },
    }
  }
}
