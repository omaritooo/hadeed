import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { GamificationService } from '~~/server/services/gamification.service'
import { SessionService } from '~~/server/services/session.service'

defineRouteMeta({
  openAPI: {
    summary: 'Complete a workout session',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['expectedVersion'],
            properties: {
              expectedVersion: { type: 'number' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The completed session and its post-workout summary (volume, duration, PRs, streak)' },
      409: { description: 'Session was modified elsewhere; check sync conflicts' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event) as { expectedVersion: number }
  const db = useDb()

  const sessionRepo = new SessionRepository(db)
  const xpRepo = new XpRepository(db)
  const streakRepo = new StreakRepository(db)
  const gamification = new GamificationService(xpRepo, streakRepo, new AchievementRepository(db), sessionRepo)
  const service = new SessionService(ctx, sessionRepo, new BlockRepository(db), gamification, xpRepo, streakRepo)

  const result = await service.completeSession(id, body.expectedVersion)
  if (result.conflict) {
    throw createError({ statusCode: 409, statusMessage: 'Session was modified elsewhere; check sync conflicts' })
  }
  return { session: result.session, summary: result.summary }
})
