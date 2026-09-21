import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'

defineRouteMeta({
  openAPI: {
    summary: 'List split days for logging a past workout',
    description: 'Every non-rest day of the active block with its exercises and last-performed loads, for the past-workout form.',
    responses: {
      200: { description: 'Past-workout form options' },
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
    new PersonalRecordRepository(db),
  )
  return service.getPastWorkoutOptions()
})
