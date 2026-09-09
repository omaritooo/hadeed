import { getQuery } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Batch-fetch exercises by id',
    description: 'Looks up multiple exercises by id in one request — used to resolve display names/images '
      + 'for a set of exercise ids (e.g. a preset\'s exercises) without one request per id.',
    parameters: [
      {
        name: 'ids',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Comma-separated list of exercise ids',
      },
    ],
    responses: {
      200: { description: 'Matching exercises' },
    },
  },
})

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const query = getQuery(event)
  const raw = typeof query.ids === 'string' ? query.ids : ''
  const ids = raw.split(',').map(value => value.trim()).filter(value => value !== '')

  return new ExerciseRepository(useDb()).findByIds(ids)
})
