import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { GamificationService } from '~~/server/services/gamification.service'
import { SessionService } from '~~/server/services/session.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event) as { expectedVersion: number }
  const db = useDb()

  const gamification = new GamificationService(new XpRepository(db), new StreakRepository(db), new AchievementRepository(db))
  const service = new SessionService(ctx, new SessionRepository(db), new BlockRepository(db), gamification)

  const result = await service.completeSession(id, body.expectedVersion)
  if (result.conflict) {
    throw createError({ statusCode: 409, statusMessage: 'Session was modified elsewhere; check sync conflicts' })
  }
  return result.session
})
