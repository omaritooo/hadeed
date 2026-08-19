import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { MuscleRepository } from '~~/server/repositories/muscle.repository'

describe('MuscleRepository', () => {
  let db: Client
  let repo: MuscleRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new MuscleRepository(db)
  })

  it('inserts and finds a muscle by name', async () => {
    await repo.insert({ name: 'chest' })
    const found = await repo.findByName('chest')
    expect(found?.name).toBe('chest')
  })

  it('getOrCreate reuses an existing row instead of duplicating', async () => {
    const first = await repo.getOrCreate('quadriceps')
    const second = await repo.getOrCreate('quadriceps')
    expect(first.id).toBe(second.id)
  })
})
