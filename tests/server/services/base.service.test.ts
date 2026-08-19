import { describe, expect, it } from 'vitest'
import { BaseService } from '~~/server/services/base.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

class TestService extends BaseService {
  checkOwner(resourceUserId: string) {
    this.requireOwner(resourceUserId)
  }
  checkPermission(permission: string) {
    this.requirePermission(permission)
  }
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return { userId: 'user-1', roles: [], permissions: [], ...overrides }
}

describe('BaseService', () => {
  it('requireOwner passes when the resource belongs to the current user', () => {
    const service = new TestService(ctx({ userId: 'user-1' }))
    expect(() => service.checkOwner('user-1')).not.toThrow()
  })

  it('requireOwner throws a 403 when the resource belongs to someone else', () => {
    const service = new TestService(ctx({ userId: 'user-1' }))
    expect(() => service.checkOwner('user-2')).toThrow(/forbidden/i)
  })

  it('requirePermission passes when the permission is present', () => {
    const service = new TestService(ctx({ permissions: ['preset:write'] }))
    expect(() => service.checkPermission('preset:write')).not.toThrow()
  })

  it('requirePermission throws a 403 when the permission is missing', () => {
    const service = new TestService(ctx({ permissions: [] }))
    expect(() => service.checkPermission('preset:write')).toThrow(/forbidden/i)
  })
})
