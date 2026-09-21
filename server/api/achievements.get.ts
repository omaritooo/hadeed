import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { GamificationService } from '~~/server/services/gamification.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get this user\'s achievements',
    description: 'Every published achievement, annotated with whether it\'s unlocked and, if not, progress toward unlocking it.',
    responses: {
      200: { description: 'Achievements with unlock state and progress' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new GamificationService(
    new XpRepository(db),
    new AchievementRepository(db),
    new SessionRepository(db),
    new BlockRepository(db),
  )
  return service.getAchievementProgress(ctx.userId)
})
