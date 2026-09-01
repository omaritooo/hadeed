import { createError } from 'h3'
import { BaseService } from '~~/server/services/base.service'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { GamificationService } from '~~/server/services/gamification.service'
import type { RequestContext } from '~~/shared/types/rbac.types'
import { startOfWeek, toSqliteDatetime } from '~~/server/utils/date'

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

    const complete = await this.sessions.isComplete(sessionId)
    if (!complete) {
      throw createError({ statusCode: 422, statusMessage: 'Session is not complete' })
    }

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

    return result
  }
}
