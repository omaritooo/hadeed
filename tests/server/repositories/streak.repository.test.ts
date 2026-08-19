import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { StreakRepository } from '~~/server/repositories/streak.repository'

describe('StreakRepository', () => {
  let db: Client
  let repo: StreakRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new StreakRepository(db)
  })

  it('starts a streak at 1 on the first recorded active day', async () => {
    const streak = await repo.recordActiveDay('user-1', '2026-08-18')
    expect(streak.currentStreak).toBe(1)
    expect(streak.longestStreak).toBe(1)
  })

  it('increments on a later active day (does not need to be consecutive calendar days — week-scoped logic lives in the service)', async () => {
    await repo.recordActiveDay('user-1', '2026-08-18')
    const streak = await repo.recordActiveDay('user-1', '2026-08-19')
    expect(streak.currentStreak).toBe(2)
  })

  it('tracks the longest streak separately from a reset current streak', async () => {
    await repo.recordActiveDay('user-1', '2026-08-18')
    await repo.recordActiveDay('user-1', '2026-08-19')
    await repo.reset('user-1')
    const streak = await repo.recordActiveDay('user-1', '2026-09-01')
    expect(streak.currentStreak).toBe(1)
    expect(streak.longestStreak).toBe(2)
  })
})
