import { getQuery, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { isJointArea } from '~~/shared/lib/joint-areas'

defineRouteMeta({
  openAPI: {
    summary: 'Find equipment-compatible fallback exercises',
    description: 'Exercises sharing the given exercise\'s movement pattern and primary muscle, restricted to '
      + 'the given equipment values, ordered by tier proximity to the source exercise then name. Used to '
      + 'offer a substitute when a picked exercise doesn\'t match the caller\'s equipment.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      {
        name: 'equipmentTiers',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Comma-separated list of acceptable exercises.equipment values (e.g. "body only,dumbbell")',
      },
      {
        name: 'avoid',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated joint areas (e.g. "knee,shoulder"). Candidates that stress any of them '
          + 'are ranked after the rest, not removed. Unknown areas are ignored.',
      },
    ],
    responses: {
      200: { description: 'Matching fallback exercises, closest tier first' },
    },
  },
})

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const id = getRouterParam(event, 'id')!
  const query = getQuery(event)
  const raw = typeof query.equipmentTiers === 'string' ? query.equipmentTiers : ''
  const equipmentTiers = raw.split(',').map(value => value.trim()).filter(value => value !== '')
  const rawAvoid = typeof query.avoid === 'string' ? query.avoid : ''
  const avoid = rawAvoid.split(',').map(value => value.trim()).filter(isJointArea)

  return new ExerciseRepository(useDb()).findFallbacks(id, equipmentTiers, avoid)
})
