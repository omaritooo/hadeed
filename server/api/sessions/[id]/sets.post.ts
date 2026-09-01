import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { GamificationService } from '~~/server/services/gamification.service'

defineRouteMeta({
  openAPI: {
    summary: 'Log a set',
    description: 'Idempotent on (id, exerciseLogId): replaying the same pair returns the existing set log.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'exerciseLogId', 'setNumber'],
            properties: {
              id: { type: 'string' },
              exerciseLogId: { type: 'string' },
              setNumber: { type: 'number' },
              weightKg: { type: 'number', nullable: true },
              reps: { type: 'number', nullable: true },
              rpe: { type: 'number', nullable: true },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The logged (or pre-existing) set' },
      403: { description: 'Exercise log is not owned by the caller' },
      404: { description: 'Exercise log not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as {
    id: string
    exerciseLogId: string
    setNumber: number
    weightKg?: number | null
    reps?: number | null
    rpe?: number | null
  }
  const repo = new SessionRepository(useDb())

  const ownerId = await repo.findExerciseLogOwnerId(body.exerciseLogId)
  if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Exercise log not found' })
  if (ownerId !== ctx.userId) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

  const exerciseId = await repo.findExerciseIdForLog(body.exerciseLogId)
  const previousBest = exerciseId ? await repo.findBestWeightForExercise(ctx.userId, exerciseId) : null

  const setLog = await repo.logSet({
    id: body.id,
    exerciseLogId: body.exerciseLogId,
    setNumber: body.setNumber,
    weightKg: body.weightKg ?? null,
    reps: body.reps ?? null,
    rpe: body.rpe ?? null,
  })

  const isNewPr = setLog.weightKg != null && (previousBest === null || setLog.weightKg > previousBest)
  if (isNewPr) {
    const db = useDb()
    const gamification = new GamificationService(new XpRepository(db), new StreakRepository(db), new AchievementRepository(db), repo)
    await gamification.onPrHit(ctx.userId, setLog.id).catch((error) => {
      console.error('GamificationService.onPrHit failed after set logged', { setLogId: setLog.id, error })
    })
  }

  return setLog
})
