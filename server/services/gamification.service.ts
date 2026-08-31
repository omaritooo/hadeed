import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { StreakRepository } from '~~/server/repositories/streak.repository'
import type { AchievementRepository } from '~~/server/repositories/achievement.repository'
import type { SessionRepository } from '~~/server/repositories/session.repository'

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

  private async evaluateAchievements(userId: string): Promise<void> {
    // Every fact every criteria type needs, fetched once per call regardless of which event
    // triggered it (onPrHit doesn't only care about PR-count achievements, since a PR can also
    // be the set that pushes total volume or session count over a threshold). These are cheap,
    // indexed reads, and evaluateAchievements only runs on session-complete / PR events, not on
    // every set logged.
    const [published, unlockedKeys, streak, sessionCount, prCount, totalVolumeKg] = await Promise.all([
      this.achievements.findPublished(),
      this.achievements.findUnlockedKeys(userId),
      this.streaks.findForUser(userId),
      this.xp.countBySourceType(userId, 'session_completed'),
      this.xp.countBySourceType(userId, 'pr'),
      this.sessions.totalVolumeKg(userId),
    ])

    for (const achievement of published) {
      if (unlockedKeys.includes(achievement.key)) continue

      let met = false
      switch (achievement.criteriaType) {
        case 'streak_length':
          met = streak.currentStreak >= (achievement.criteriaValue.days as number)
          break
        case 'session_count':
          met = sessionCount >= (achievement.criteriaValue.count as number)
          break
        case 'pr_count':
          met = prCount >= (achievement.criteriaValue.count as number)
          break
        case 'total_volume_kg':
          met = totalVolumeKg >= (achievement.criteriaValue.kg as number)
          break
        case 'target_hit':
          // Not implemented: no achievement is currently seeded with this criteria type.
          // Would need wiring into ProfileService/TargetRepository's target-hit detection.
          break
      }

      if (met) {
        await this.achievements.unlock(userId, achievement.id)
      }
    }
  }
}
