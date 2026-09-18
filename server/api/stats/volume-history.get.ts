import { getQuery } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'
import { WEEKLY_VOLUME_HISTORY_DEFAULT_WEEKS } from '~~/shared/types/workouts.types'

defineRouteMeta({
  openAPI: {
    summary: 'Get historical training volume by muscle, one snapshot per week',
    description: 'Sets logged per primary muscle for each of the last N weeks (default 8, capped at 12), '
      + 'oldest first, banded low/optimal/high against the same MAV thresholds as the current-week summary. '
      + 'Powers the Stats tab\'s volume trend chart.',
    parameters: [
      {
        name: 'weeks',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 12, default: WEEKLY_VOLUME_HISTORY_DEFAULT_WEEKS },
        description: 'How many trailing weeks to include (clamped to 1-12).',
      },
    ],
    responses: {
      200: { description: 'Weekly volume-by-muscle snapshots, oldest week first' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const query = getQuery(event)
  const weeksParam = Number(query.weeks)
  const weeks = Number.isFinite(weeksParam) && weeksParam > 0 ? weeksParam : undefined

  const db = useDb()
  const service = new WorkoutsService(
    ctx,
    new SessionRepository(db),
    new BlockRepository(db),
    new ExerciseRepository(db),
    new PersonalRecordRepository(db),
  )
  return service.getWeeklyVolumeHistory(ctx.userId, weeks)
})
