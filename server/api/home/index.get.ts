import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { HomeService } from '~~/server/services/home.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get the home dashboard summary',
    description: 'Streak, XP/level, today\'s (next-in-rotation) workout, an in-progress session if any, this week\'s training progress, the most recently completed session, recent PRs, and recently unlocked achievements.',
    responses: {
      200: { description: 'Home dashboard summary' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new HomeService(
    ctx,
    new SessionRepository(db),
    new BlockRepository(db),
    new StreakRepository(db),
    new XpRepository(db),
    new AchievementRepository(db),
    new ExerciseRepository(db),
    new BodyMetricsRepository(db),
  )
  return service.getSummary()
})
