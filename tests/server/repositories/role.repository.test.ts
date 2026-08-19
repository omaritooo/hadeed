import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { RoleRepository } from '~~/server/repositories/role.repository'

describe('RoleRepository', () => {
  let db: Client
  let repo: RoleRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new RoleRepository(db)
  })

  it('round-trips the permissions array through JSON', async () => {
    const role = await repo.insert({ key: 'admin', name: 'Admin', permissions: ['preset:write', 'achievement:write'] })
    expect(role.permissions).toEqual(['preset:write', 'achievement:write'])

    const found = await repo.findById(role.id)
    expect(found?.permissions).toEqual(['preset:write', 'achievement:write'])
  })

  it('finds a role by key', async () => {
    await repo.insert({ key: 'member', name: 'Member', permissions: [] })
    const found = await repo.findByKey('member')
    expect(found?.name).toBe('Member')
  })

  it('assigns and lists roles for a user', async () => {
    const role = await repo.insert({ key: 'admin', name: 'Admin', permissions: ['preset:write'] })
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })

    await repo.assignToUser('user-1', role.id)
    const roles = await repo.findForUser('user-1')
    expect(roles).toHaveLength(1)
    expect(roles[0]?.key).toBe('admin')
  })
})
