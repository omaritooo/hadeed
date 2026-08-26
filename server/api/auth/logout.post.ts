import { useDb } from '~~/server/utils/db'
import { AuthSessionRepository } from '~~/server/repositories/auth-session.repository'
import { clearSessionCookie, getSessionCookie } from '~~/server/utils/session-cookie'

export default defineEventHandler(async (event) => {
  const sessionId = getSessionCookie(event)
  if (sessionId) {
    await new AuthSessionRepository(useDb()).delete(sessionId)
  }
  clearSessionCookie(event)
  return { success: true }
})
