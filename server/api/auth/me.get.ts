import { getRequestContext } from '~~/server/utils/get-request-context'

export default defineEventHandler(async (event) => {
  try {
    const ctx = await getRequestContext(event)
    return { userId: ctx.userId }
  } catch {
    return null
  }
})
