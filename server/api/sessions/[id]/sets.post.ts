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

  // logSet's idempotent-replay path (see session.repository.ts) returns a pre-existing
  // set log's real weightKg/reps/rpe when the same (id, exerciseLogId) pair is replayed —
  // that's no longer just a fresh write, so this route can no longer treat itself as
  // write-only and skip ownership. The lookup costs one indexed query on the hottest
  // write path in this feature, same as the check editSetLog's route already pays.
  const ownerId = await repo.findExerciseLogOwnerId(body.exerciseLogId)
  if (!ownerId) throw createError({ statusCode: 404, statusMessage: 'Exercise log not found' })
  if (ownerId !== ctx.userId) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

  // Read the pre-write best for this exercise before logging the new set, so a replay of an
  // already-applied set (whose weight is already folded into that best) can never re-fire a PR --
  // no separate idempotency handling needed here beyond what logSet/XpRepository.award already do.
  const exerciseId = await repo.findExerciseIdForLog(body.exerciseLogId)
  const previousBest = exerciseId ? await repo.findBestWeightForExercise(ctx.userId, exerciseId) : null

  // Normalize omitted fields to null before they reach the repository. A client logging
  // a bodyweight_reps or time set very plausibly omits weightKg/reps rather than sending
  // an explicit null, and LogSetInput's fields are all nullable — passing an omitted
  // (i.e. `undefined`) field straight through would throw at the db layer, since
  // @libsql/client rejects `undefined` bind args (see the same bug fixed in
  // sets/[setId].patch.ts).
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
    // Best-effort, same as GamificationService.onSessionCompleted's own failure handling --
    // a PR celebration/achievement failing must never turn a successfully logged set into an error.
    await gamification.onPrHit(ctx.userId, setLog.id).catch((error) => {
      console.error('GamificationService.onPrHit failed after set logged', { setLogId: setLog.id, error })
    })
  }

  return setLog
})
