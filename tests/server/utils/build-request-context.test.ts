import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { RoleRepository } from '~~/server/repositories/role.repository'
import { buildRequestContext } from '~~/server/utils/build-request-context'

describe('buildRequestContext', () => {
  let db: Client

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  })

  it('flattens and dedupes permissions across all of a user\'s roles', async () => {
    const roles = new RoleRepository(db)
    const admin = await roles.insert({ key: 'admin', name: 'Admin', permissions: ['preset:write', 'shared:read'] })
    const editor = await roles.insert({ key: 'editor', name: 'Editor', permissions: ['shared:read', 'achievement:write'] })
    await roles.assignToUser('user-1', admin.id)
    await roles.assignToUser('user-1', editor.id)

    const ctx = await buildRequestContext(db, 'user-1')

    expect(ctx.userId).toBe('user-1')
    expect(ctx.roles.sort()).toEqual(['admin', 'editor'])
    expect(ctx.permissions.sort()).toEqual(['achievement:write', 'preset:write', 'shared:read'])
  })

  it('returns empty roles/permissions for a user with no roles', async () => {
    const ctx = await buildRequestContext(db, 'user-1')
    expect(ctx.roles).toEqual([])
    expect(ctx.permissions).toEqual([])
  })
})
