import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get the workouts page summary',
    description: 'Today\'s scheduled day (or in-progress session), and recent completed sessions/PRs.',
    responses: {
      200: { description: 'Workouts summary' },
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
  return service.getSummary()
})
