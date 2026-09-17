import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { GamificationService } from '~~/server/services/gamification.service'
import { SessionService } from '~~/server/services/session.service'

defineRouteMeta({
  openAPI: {
    summary: 'Start a workout session',
    description: 'Expires any stale in-progress sessions for the user, then starts a new one, snapshotting a progression suggestion per exercise.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'exercises'],
            properties: {
              id: { type: 'string' },
              splitDayId: { type: 'number', nullable: true },
              format: { type: 'string', enum: ['straight_sets', 'circuit'] },
              rounds: { type: 'number' },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'exerciseId', 'position', 'setType'],
                  properties: {
                    id: { type: 'string' },
                    exerciseId: { type: 'string' },
                    splitExerciseId: { type: 'number', nullable: true },
                    position: { type: 'number' },
                    setType: { type: 'string', enum: ['weight_reps', 'bodyweight_reps', 'time'] },
                    targetSets: { type: 'number', nullable: true },
                    targetRepsMin: { type: 'number', nullable: true },
                    targetRepsMax: { type: 'number', nullable: true },
                    targetReps: { type: 'number', nullable: true, deprecated: true, description: 'Accepted for older app builds only. Used as both targetRepsMin and targetRepsMax when those are absent.' },
                    targetRpe: { type: 'number', nullable: true },
                    restSeconds: { type: 'number', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The started session' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const db = useDb()

  const sessions = new SessionRepository(db)
  const xp = new XpRepository(db)
  const streaks = new StreakRepository(db)
  const gamification = new GamificationService(xp, streaks, new AchievementRepository(db), sessions)
  const service = new SessionService(ctx, sessions, new BlockRepository(db), gamification, xp, streaks, {
    exercises: new ExerciseRepository(db),
    profiles: new ProfileRepository(db),
  })

  return service.startSession(body)
})
