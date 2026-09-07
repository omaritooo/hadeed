import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get this week\'s training volume by muscle',
    description: 'Sets logged so far this week per primary muscle, banded low/optimal/high against MAV thresholds.',
    responses: {
      200: { description: 'Weekly volume by muscle' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const service = new WorkoutsService(
    ctx,
    new SessionRepository(db),
    new BlockRepository(db),
    new ExerciseRepository(db),
    new XpRepository(db),
  )
  return service.getWeeklyVolume(ctx.userId)
})
