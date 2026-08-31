import { isError } from 'h3'
import { getRequestContext } from '~~/server/utils/get-request-context'

defineRouteMeta({
  openAPI: {
    summary: 'Get current user',
    description: 'Returns the authenticated user id, or null if there is no valid session.',
    responses: {
      200: {
        description: 'Current session state',
        content: { 'application/json': { schema: { type: 'object', properties: { userId: { type: 'string', nullable: true } } } } },
      },
    },
  },
})

export default defineEventHandler(async (event) => {
  try {
    const ctx = await getRequestContext(event)
    return { userId: ctx.userId }
  } catch (err) {
    if (isError(err) && err.statusCode === 401) return { userId: null }
    throw err
  }
})
