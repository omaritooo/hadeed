import type { H3Event } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'
import { GamificationService } from '~~/server/services/gamification.service'
import { SessionService } from '~~/server/services/session.service'

// One wiring for every session route: the repository graph behind a session is the same whether
// the request starts one, logs a set into it or completes it, and the routes differ only in which
// method they call.
export const useSessionService = async (event: H3Event): Promise<SessionService> => {
  const ctx = await getRequestContext(event)
  const db = useDb()
  const sessions = new SessionRepository(db)
  const xp = new XpRepository(db)
  const blocks = new BlockRepository(db)
  const gamification = new GamificationService(xp, new AchievementRepository(db), sessions, blocks)
  return new SessionService(ctx, sessions, blocks, gamification, new PersonalRecordRepository(db), {
    exercises: new ExerciseRepository(db),
    profiles: new ProfileRepository(db),
  })
}
