import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { BaseRepository } from '~~/server/repositories/base.repository'

interface Widget {
  id: number
  name: string
  color: string
}

class WidgetRepository extends BaseRepository<Widget> {
  protected tableName = 'widgets'
  protected mapRow(row: Record<string, unknown>): Widget {
    return { id: row.id as number, name: row.name as string, color: row.color as string }
  }
}

describe('BaseRepository', () => {
  let db: Client
  let repo: WidgetRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute('CREATE TABLE widgets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL)')
    repo = new WidgetRepository(db)
  })

  it('inserts and finds by id with multiple columns', async () => {
    const created = await repo.insert({ name: 'sprocket', color: 'red' })
    expect(created).toEqual({ id: created.id, name: 'sprocket', color: 'red' })

    const found = await repo.findById(created.id)
    expect(found).toEqual(created)
  })

  it('finds many by a multi-key where clause', async () => {
    await repo.insert({ name: 'a', color: 'red' })
    await repo.insert({ name: 'a', color: 'blue' })

    expect(await repo.findMany({ name: 'a', color: 'red' })).toHaveLength(1)
  })

  it('updates multiple columns at once', async () => {
    const created = await repo.insert({ name: 'old', color: 'red' })
    const updated = await repo.update(created.id, { name: 'new', color: 'blue' })
    expect(updated).toEqual({ id: created.id, name: 'new', color: 'blue' })
  })

  it('inserts and finds by id', async () => {
    const created = await repo.insert({ name: 'sprocket', color: 'red' })
    expect(created.name).toBe('sprocket')

    const found = await repo.findById(created.id)
    expect(found).toEqual(created)
  })

  it('returns null from findById when missing', async () => {
    expect(await repo.findById(999)).toBeNull()
  })

  it('finds many by a where clause', async () => {
    await repo.insert({ name: 'a', color: 'red' })
    await repo.insert({ name: 'a', color: 'blue' })
    await repo.insert({ name: 'b', color: 'red' })

    expect(await repo.findMany({ name: 'a' })).toHaveLength(2)
    expect(await repo.findMany()).toHaveLength(3)
  })

  it('updates a row', async () => {
    const created = await repo.insert({ name: 'old', color: 'red' })
    const updated = await repo.update(created.id, { name: 'new' })
    expect(updated?.name).toBe('new')
  })

  it('deletes a row', async () => {
    const created = await repo.insert({ name: 'gone', color: 'red' })
    await repo.delete(created.id)
    expect(await repo.findById(created.id)).toBeNull()
  })
})
