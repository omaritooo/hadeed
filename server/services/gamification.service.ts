import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { StreakRepository } from '~~/server/repositories/streak.repository'
import type { AchievementRepository } from '~~/server/repositories/achievement.repository'

const XP_PER_SET = 10
const XP_SESSION_COMPLETE_BONUS = 25
const XP_PR_BONUS = 50

export interface SessionCompletionFacts {
  scheduledDaysThisWeek: number
  completedDaysThisWeek: number
  missedScheduledDay?: boolean
}

export class GamificationService {
  constructor(
    private xp: XpRepository,
    private streaks: StreakRepository,
    private achievements: AchievementRepository,
  ) {}

  async onSetLogged(userId: string, setId: string): Promise<void> {
    await this.xp.award(userId, XP_PER_SET, 'set_logged', setId)
  }

  async onPrHit(userId: string, prId: string): Promise<void> {
    await this.xp.award(userId, XP_PR_BONUS, 'pr', prId)
    await this.evaluateAchievements(userId)
  }

  async onSessionCompleted(userId: string, sessionId: string, facts: SessionCompletionFacts): Promise<void> {
    await this.xp.award(userId, XP_SESSION_COMPLETE_BONUS, 'session_completed', sessionId)

    if (facts.missedScheduledDay) {
      await this.streaks.reset(userId)
    } else if (facts.completedDaysThisWeek === facts.scheduledDaysThisWeek) {
      await this.streaks.recordActiveDay(userId, new Date().toISOString().slice(0, 10))
    }

    await this.evaluateAchievements(userId)
  }

  private async evaluateAchievements(userId: string): Promise<void> {
    const [published, unlockedKeys, streak] = await Promise.all([
      this.achievements.findPublished(),
      this.achievements.findUnlockedKeys(userId),
      this.streaks.findForUser(userId),
    ])

    for (const achievement of published) {
      if (unlockedKeys.includes(achievement.key)) continue

      let met = false
      if (achievement.criteriaType === 'streak_length') {
        const threshold = achievement.criteriaValue.days as number
        met = streak.currentStreak >= threshold
      }

      if (met) {
        await this.achievements.unlock(userId, achievement.id)
      }
    }
  }
}
