import { createError } from 'h3'
import { BaseService } from '~~/server/services/base.service'
import type { HydrationRepository } from '~~/server/repositories/hydration.repository'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { HydrationLog, HydrationToday } from '~~/shared/types/hydration.types'
import { toSqliteDatetime } from '~~/server/utils/date'

const todayRange = (): { start: string, end: string } => {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 1)
  return { start: toSqliteDatetime(start), end: toSqliteDatetime(end) }
}

export class HydrationService extends BaseService {
  constructor(
    ctx: RequestContext,
    private hydration: HydrationRepository,
    private profiles: ProfileRepository,
  ) {
    super(ctx)
  }

  async logIntake(amountMl: number): Promise<HydrationLog> {
    if (!Number.isFinite(amountMl) || amountMl <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'amountMl must be a positive number' })
    }
    return this.hydration.log(this.ctx.userId, amountMl)
  }

  async deleteEntry(id: number): Promise<void> {
    await this.hydration.delete(id, this.ctx.userId)
  }

  async setTarget(targetMl: number | null): Promise<void> {
    if (targetMl !== null && (!Number.isFinite(targetMl) || targetMl <= 0)) {
      throw createError({ statusCode: 400, statusMessage: 'targetMl must be a positive number or null' })
    }
    await this.profiles.setHydrationTarget(this.ctx.userId, targetMl)
  }

  async getToday(): Promise<HydrationToday> {
    const { start, end } = todayRange()
    const [logs, profile] = await Promise.all([
      this.hydration.findForRange(this.ctx.userId, start, end),
      this.profiles.findByUserId(this.ctx.userId),
    ])
    const totalMl = logs.reduce((sum, log) => sum + log.amountMl, 0)
    const targetMl = profile?.hydrationTargetMl ?? null
    return {
      totalMl,
      targetMl,
      remainingMl: targetMl !== null ? Math.max(0, targetMl - totalMl) : null,
      logs,
    }
  }
}
