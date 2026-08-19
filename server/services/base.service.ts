import { createError } from 'h3'
import type { RequestContext } from '~~/shared/types/rbac.types'

export abstract class BaseService {
  constructor(protected ctx: RequestContext) {}

  protected requireOwner(resourceUserId: string): void {
    if (resourceUserId !== this.ctx.userId) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }
  }

  protected requirePermission(permission: string): void {
    if (!this.ctx.permissions.includes(permission)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }
  }
}
