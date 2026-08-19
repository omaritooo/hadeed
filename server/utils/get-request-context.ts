import type { H3Event } from 'h3'
import { createError, getHeader } from 'h3'
import { useDb } from '~~/server/utils/db'
import { buildRequestContext } from '~~/server/utils/build-request-context'
import type { RequestContext } from '~~/shared/types/rbac.types'

export async function getRequestContext(event: H3Event): Promise<RequestContext> {
  const userId = getHeader(event, 'x-user-id')
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'Missing x-user-id header' })
  }
  return buildRequestContext(useDb(), userId)
}
