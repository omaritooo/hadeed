import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { WorkoutsService } from '~~/server/services/workouts.service'
import { HomeService } from '~~/server/services/home.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

function ctx(userId = 'user-1'): RequestContext {
  return { userId, roles: [], permissions: [] }
}

describe('HomeService', () => {
  let db: Client
  let service: HomeService

  beforeEach(async () => {
    db = await createTestDb()
    const sessions = new SessionRepository(db)
    const blocks = new BlockRepository(db)
    const exercises = new ExerciseRepository(db)
    const xp = new XpRepository(db)
    const workouts = new WorkoutsService(ctx(), sessions, blocks, exercises, xp)
    service = new HomeService(ctx(), sessions, blocks, new StreakRepository(db), xp, new AchievementRepository(db), new BodyMetricsRepository(db), workouts)
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  })

  it('returns a summary with null todaysWorkout/activeSession when there is no active block', async () => {
    const summary = await service.getSummary()
    expect(summary.todaysWorkout).toBeNull()
    expect(summary.activeSession).toBeNull()
    expect(summary.streak).toEqual({ current: 0, longest: 0 })
  })
})
