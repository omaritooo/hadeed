import { createError } from 'h3'
import { BaseService } from '~~/server/services/base.service'
import type { RoleRepository } from '~~/server/repositories/role.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'

export class RoleService extends BaseService {
  constructor(ctx: RequestContext, private roles: RoleRepository) {
    super(ctx)
  }

  async assignRole(userId: string, roleKey: string): Promise<void> {
    this.requirePermission('role:write')
    const role = await this.roles.findByKey(roleKey)
    if (!role) throw createError({ statusCode: 400, statusMessage: `Unknown role: ${roleKey}` })
    await this.roles.assignToUser(userId, role.id)
  }
}
