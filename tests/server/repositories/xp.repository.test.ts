import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { XpRepository } from '~~/server/repositories/xp.repository'

describe('XpRepository', () => {
  let db: Client
  let repo: XpRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new XpRepository(db)
  })

  it('sums awarded xp for a user', async () => {
    await repo.award('user-1', 10, 'set_logged', 'set-1')
    await repo.award('user-1', 10, 'set_logged', 'set-2')
    expect(await repo.totalForUser('user-1')).toBe(20)
  })

  it('is idempotent: awarding the same source twice only counts once', async () => {
    await repo.award('user-1', 10, 'set_logged', 'set-1')
    await repo.award('user-1', 10, 'set_logged', 'set-1')
    expect(await repo.totalForUser('user-1')).toBe(10)
  })

  describe('findPrsForSession', () => {
    beforeEach(async () => {
      await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')" })
      await db.execute({
        sql: `INSERT INTO workout_sessions (id, user_id) VALUES ('session-1', 'user-1'), ('session-2', 'user-1')`,
      })
      await db.execute({
        sql: `INSERT INTO exercise_logs (id, session_id, exercise_id, position, set_type)
              VALUES ('exlog-1', 'session-1', 'bench-press', 0, 'weight_reps'), ('exlog-2', 'session-2', 'bench-press', 0, 'weight_reps')`,
      })
      await db.execute({
        sql: `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps)
              VALUES ('set-1', 'exlog-1', 1, 100, 5), ('set-2', 'exlog-2', 1, 110, 3)`,
      })
    })

    it('returns only the PRs whose source set belongs to the given session', async () => {
      await repo.award('user-1', 50, 'pr', 'set-1')
      await repo.award('user-1', 50, 'pr', 'set-2')

      expect(await repo.findPrsForSession('user-1', 'session-1')).toEqual([{ exerciseName: 'Bench Press', weightKg: 100, reps: 5 }])
      expect(await repo.findPrsForSession('user-1', 'session-2')).toEqual([{ exerciseName: 'Bench Press', weightKg: 110, reps: 3 }])
    })

    it('excludes non-PR xp_ledger entries, e.g. set_logged awards', async () => {
      await repo.award('user-1', 10, 'set_logged', 'set-1')

      expect(await repo.findPrsForSession('user-1', 'session-1')).toEqual([])
    })

    it('returns an empty array when the session has no PRs', async () => {
      expect(await repo.findPrsForSession('user-1', 'session-1')).toEqual([])
    })
  })
})
