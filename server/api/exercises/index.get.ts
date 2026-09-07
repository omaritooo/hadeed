import { getQuery } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Search exercises by name',
    parameters: [
      { name: 'search', in: 'query', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: { description: 'Matching exercises, ordered by name, capped at 30' },
    },
  },
})

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search : ''
  return new ExerciseRepository(useDb()).search(search)
})
