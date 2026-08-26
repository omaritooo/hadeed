import type { H3Event } from 'h3'
import { createError } from 'h3'
import { useDb } from '~~/server/utils/db'
import { buildRequestContext } from '~~/server/utils/build-request-context'
import { AuthSessionRepository } from '~~/server/repositories/auth-session.repository'
import { getSessionCookie } from '~~/server/utils/session-cookie'
import type { RequestContext } from '~~/shared/types/rbac.types'

export async function getRequestContext(event: H3Event): Promise<RequestContext> {
  const sessionId = getSessionCookie(event)
  if (!sessionId) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const db = useDb()
  const session = await new AuthSessionRepository(db).findValid(sessionId)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  return buildRequestContext(db, session.userId)
}
