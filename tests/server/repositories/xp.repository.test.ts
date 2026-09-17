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

  describe('recentPrs', () => {
    beforeEach(async () => {
      await db.execute({ sql: "INSERT INTO exercises (id, name, instructions) VALUES ('bench-press', 'Bench Press', '[]')" })
      await db.execute({
        sql: `INSERT INTO workout_sessions (id, user_id) VALUES ('session-1', 'user-1'), ('session-2', 'user-1'), ('session-3', 'user-1')`,
      })
      await db.execute({
        sql: `INSERT INTO exercise_logs (id, session_id, exercise_id, position, set_type)
              VALUES ('exlog-1', 'session-1', 'bench-press', 0, 'weight_reps'),
                     ('exlog-2', 'session-2', 'bench-press', 0, 'weight_reps'),
                     ('exlog-3', 'session-3', 'bench-press', 0, 'weight_reps')`,
      })
      await db.execute({
        sql: `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, logged_at)
              VALUES ('set-1', 'exlog-1', 1, 100, 5, '2026-01-01 00:00:00'),
                     ('set-2', 'exlog-2', 1, 110, 5, '2026-01-08 00:00:00'),
                     ('set-3', 'exlog-3', 1, 120, 5, '2026-01-15 00:00:00')`,
      })
      // Insert xp_ledger rows directly with explicit, distinct created_at values rather than via
      // award() (whose created_at defaults to datetime('now'), only second-resolution — three
      // awards in the same test could tie and make the DESC ordering assertions below flaky).
      await db.execute({
        sql: `INSERT INTO xp_ledger (user_id, amount, source_type, source_id, created_at)
              VALUES ('user-1', 50, 'pr', 'set-1', '2026-01-01 00:00:00'),
                     ('user-1', 50, 'pr', 'set-2', '2026-01-08 00:00:00'),
                     ('user-1', 50, 'pr', 'set-3', '2026-01-15 00:00:00')`,
      })
    })

    it('returns the full PR history, most recent first, when no limit is given', async () => {
      const prs = await repo.recentPrs('user-1')
      expect(prs).toHaveLength(3)
      expect(prs.map(pr => pr.weightKg)).toEqual([120, 110, 100])
    })

    it('caps the result when a limit is given, still most recent first', async () => {
      const prs = await repo.recentPrs('user-1', 2)
      expect(prs).toHaveLength(2)
      expect(prs.map(pr => pr.weightKg)).toEqual([120, 110])
    })
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

      expect(await repo.findPrsForSession('user-1', 'session-1')).toEqual([{ exerciseName: 'Bench Press', weightKg: 100, reps: 5, prTypes: ['weight'], e1rmKg: null }])
      expect(await repo.findPrsForSession('user-1', 'session-2')).toEqual([{ exerciseName: 'Bench Press', weightKg: 110, reps: 3, prTypes: ['weight'], e1rmKg: null }])
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
