import { isError } from 'h3'
import { getRequestContext } from '~~/server/utils/get-request-context'

export default defineEventHandler(async (event) => {
  try {
    const ctx = await getRequestContext(event)
    return { userId: ctx.userId }
  } catch (err) {
    if (isError(err) && err.statusCode === 401) return { userId: null }
    throw err
  }
})
