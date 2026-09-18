import { getQuery } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Get the full personal-record history',
    description: 'Every PR the caller has hit, most recent first, uncapped by default (unlike the '
      + 'home/workouts summaries, which only show the 5 most recent). Powers the Stats tab\'s PR '
      + 'timeline. An optional `limit` query param caps the result for pagination.',
    parameters: [
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1 },
        description: 'Optional cap on the number of PRs returned (most recent first). Omit for the full history.',
      },
    ],
    responses: {
      200: { description: 'PR history, most recent first' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const query = getQuery(event)
  const limitParam = Number(query.limit)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined

  const db = useDb()
  return new PersonalRecordRepository(db).recent(ctx.userId, limit)
})
