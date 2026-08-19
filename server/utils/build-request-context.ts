import type { Client } from '@libsql/client'
import { RoleRepository } from '~~/server/repositories/role.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'

export async function buildRequestContext(db: Client, userId: string): Promise<RequestContext> {
  const roles = await new RoleRepository(db).findForUser(userId)
  const permissions = [...new Set(roles.flatMap(role => role.permissions))]
  return { userId, roles: roles.map(role => role.key), permissions }
}
