import { getQuery, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Find swap alternatives for an exercise',
    description: 'Exercises sharing the given exercise\'s movement pattern and primary muscle, restricted to '
      + 'the given equipment values, ordered by tier proximity to the source exercise then name. Powers the '
      + 'Exercise Swap Sheet, where any picked exercise can be swapped for another for any reason (taste, '
      + 'equipment, preference) — not only an equipment mismatch.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      {
        name: 'equipmentTiers',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Comma-separated list of acceptable exercises.equipment values (e.g. "body only,dumbbell")',
      },
    ],
    responses: {
      200: { description: 'Matching alternative exercises, closest tier first' },
    },
  },
})

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const id = getRouterParam(event, 'id')!
  const query = getQuery(event)
  const raw = typeof query.equipmentTiers === 'string' ? query.equipmentTiers : ''
  const equipmentTiers = raw.split(',').map(value => value.trim()).filter(value => value !== '')

  return new ExerciseRepository(useDb()).findFallbacks(id, equipmentTiers)
})
