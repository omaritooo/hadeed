import { createError } from 'h3'
import { BaseService } from '~~/server/services/base.service'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { GamificationService } from '~~/server/services/gamification.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

function startOfWeek(date: Date): Date {
  const day = date.getUTCDay() // 0 = Sunday
  const diff = (day + 6) % 7 // days since Monday
  const start = new Date(date)
  start.setUTCDate(date.getUTCDate() - diff)
  start.setUTCHours(0, 0, 0, 0)
  return start
}

export class SessionService extends BaseService {
  constructor(
    ctx: RequestContext,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
    private gamification: GamificationService,
  ) {
    super(ctx)
  }

  private async requireOwnedSession(sessionId: string) {
    const session = await this.sessions.findSessionById(sessionId)
    if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
    this.requireOwner(session.userId)
    return session
  }

  async completeSession(sessionId: string, expectedVersion: number) {
    await this.requireOwnedSession(sessionId)

    const result = await this.sessions.completeSession(sessionId, expectedVersion)
    if (result.conflict) return result

    const now = new Date()
    const weekStart = startOfWeek(now)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7)

    const activeBlock = await this.blocks.findActiveForUser(this.ctx.userId, now.toISOString().slice(0, 10))
    const scheduledDaysThisWeek = activeBlock?.days.length ?? 0

    const completedDaysThisWeek = await this.sessions.countTrainedDaysInRange(
      this.ctx.userId,
      weekStart.toISOString(),
      weekEnd.toISOString(),
    )

    // missedScheduledDay is a fact about a *closed, past* week ("the week ended and
    // quota wasn't hit") — it can never be soundly derived from this week's still-open
    // running count, since completedDaysThisWeek < scheduledDaysThisWeek is true for
    // every mid-week completion right up until the last one that satisfies the target.
    // Detecting a genuinely missed week needs a lazy check-on-next-relevant-action
    // mechanism (analogous to SessionRepository.expireStaleSessions), which this plan
    // does not build. Deferred, not forgotten — always report false here and let
    // GamificationService's completedDaysThisWeek === scheduledDaysThisWeek branch be
    // the only thing that advances the streak.
    const missedScheduledDay = false

    // Gamification (XP/streaks/achievements) is a non-authoritative bonus layer on top
    // of session completion, which is already durably committed above. Never let a
    // failure here surface as an error on an otherwise-successful completion — and
    // there's no retry path that could re-run this safely, since a retried
    // completeSession call would just hit the conflict branch.
    try {
      await this.gamification.onSessionCompleted(this.ctx.userId, sessionId, {
        scheduledDaysThisWeek,
        completedDaysThisWeek,
        missedScheduledDay,
      })
    } catch (error) {
      console.error('GamificationService.onSessionCompleted failed after session completion', { sessionId, error })
    }

    return result
  }
}
