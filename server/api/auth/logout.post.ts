import { useDb } from '~~/server/utils/db'
import { AuthSessionRepository } from '~~/server/repositories/auth-session.repository'
import { clearSessionCookie, getSessionCookie } from '~~/server/utils/session-cookie'

defineRouteMeta({
  openAPI: {
    summary: 'Log out',
    description: 'Deletes the current session (if any) and clears the session cookie.',
    responses: {
      200: {
        description: 'Logged out',
        content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } },
      },
    },
  },
})

export default defineEventHandler(async (event) => {
  const sessionId = getSessionCookie(event)
  if (sessionId) {
    await new AuthSessionRepository(useDb()).delete(sessionId)
  }
  clearSessionCookie(event)
  return { success: true }
})
