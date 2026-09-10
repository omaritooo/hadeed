import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { StreakRepository } from '~~/server/repositories/streak.repository'
import type { AchievementRepository } from '~~/server/repositories/achievement.repository'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { Achievement, AchievementWithProgress, Streak } from '~~/shared/types/gamification.types'

const XP_PER_SET = 10
const XP_SESSION_COMPLETE_BONUS = 25
const XP_PR_BONUS = 50

export interface SessionCompletionFacts {
  scheduledDaysThisWeek: number
  completedDaysThisWeek: number
  missedScheduledDay?: boolean
}

interface AchievementFacts {
  published: Achievement[]
  unlockedKeys: string[]
  streak: Streak
  sessionCount: number
  prCount: number
  totalVolumeKg: number
}

export class GamificationService {
  constructor(
    private xp: XpRepository,
    private streaks: StreakRepository,
    private achievements: AchievementRepository,
    private sessions: SessionRepository,
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

  /**
   * Returns every published achievement for the user, annotated with whether it's unlocked
   * and, if not, how close the user is to unlocking it. Reuses the exact same underlying facts
   * (streak, session count, PR count, total volume) that `evaluateAchievements` gathers to decide
   * unlocks, so progress shown to the user can never drift from progress used to unlock.
   */
  async getAchievementProgress(userId: string): Promise<AchievementWithProgress[]> {
    const facts = await this.gatherAchievementFacts(userId)

    return facts.published.map((achievement) => {
      const unlocked = facts.unlockedKeys.includes(achievement.key)
      return {
        key: achievement.key,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        criteriaType: achievement.criteriaType,
        unlocked,
        progress: unlocked ? null : this.computeProgress(achievement, facts),
      }
    })
  }

  private computeProgress(achievement: Achievement, facts: AchievementFacts): AchievementWithProgress['progress'] {
    switch (achievement.criteriaType) {
      case 'streak_length':
        return { current: facts.streak.currentStreak, target: achievement.criteriaValue.days as number, unit: 'days' }
      case 'session_count':
        return { current: facts.sessionCount, target: achievement.criteriaValue.count as number, unit: 'sessions' }
      case 'pr_count':
        return { current: facts.prCount, target: achievement.criteriaValue.count as number, unit: 'PRs' }
      case 'total_volume_kg':
        return { current: facts.totalVolumeKg, target: achievement.criteriaValue.kg as number, unit: 'kg' }
      case 'target_hit':
        return null
    }
  }

  private async gatherAchievementFacts(userId: string): Promise<AchievementFacts> {
    const [published, unlockedKeys, streak, sessionCount, prCount, totalVolumeKg] = await Promise.all([
      this.achievements.findPublished(),
      this.achievements.findUnlockedKeys(userId),
      this.streaks.findForUser(userId),
      this.xp.countBySourceType(userId, 'session_completed'),
      this.xp.countBySourceType(userId, 'pr'),
      this.sessions.totalVolumeKg(userId),
    ])
    return { published, unlockedKeys, streak, sessionCount, prCount, totalVolumeKg }
  }

  private async evaluateAchievements(userId: string): Promise<void> {
    const facts = await this.gatherAchievementFacts(userId)

    for (const achievement of facts.published) {
      if (facts.unlockedKeys.includes(achievement.key)) continue

      let met = false
      switch (achievement.criteriaType) {
        case 'streak_length':
          met = facts.streak.currentStreak >= (achievement.criteriaValue.days as number)
          break
        case 'session_count':
          met = facts.sessionCount >= (achievement.criteriaValue.count as number)
          break
        case 'pr_count':
          met = facts.prCount >= (achievement.criteriaValue.count as number)
          break
        case 'total_volume_kg':
          met = facts.totalVolumeKg >= (achievement.criteriaValue.kg as number)
          break
        case 'target_hit':
          break
      }

      if (met) {
        await this.achievements.unlock(userId, achievement.id)
      }
    }
  }
}
