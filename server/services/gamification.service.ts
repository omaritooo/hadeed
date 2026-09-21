import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { AchievementRepository } from '~~/server/repositories/achievement.repository'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import { startOfWeek } from '~~/server/utils/date'
import { buildStreakWeeks, computeWeekStreak, type WeekStreak } from '~~/shared/lib/streak'
import type { Achievement, AchievementWithProgress } from '~~/shared/types/gamification.types'

const XP_PER_SET = 10
const XP_SESSION_COMPLETE_BONUS = 25
const XP_PR_BONUS = 50

interface AchievementFacts {
  published: Achievement[]
  unlockedKeys: string[]
  streak: WeekStreak
  sessionCount: number
  prCount: number
  totalVolumeKg: number
}

export class GamificationService {
  constructor(
    private xp: XpRepository,
    private achievements: AchievementRepository,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
  ) {}

  async onSetLogged(userId: string, setId: string): Promise<void> {
    await this.xp.award(userId, XP_PER_SET, 'set_logged', setId)
  }

  async onPrHit(userId: string, prId: string): Promise<void> {
    await this.xp.award(userId, XP_PR_BONUS, 'pr', prId)
    await this.evaluateAchievements(userId)
  }

  // Called when a set is deleted (both rewards) or edited (PR only, before re-detection), so a
  // fake PR can't be logged, deleted and re-logged under a fresh id for repeated XP.
  async revokeSetRewards(userId: string, setId: string, options: { includeSetXp: boolean }): Promise<void> {
    await this.xp.revoke(userId, 'pr', setId)
    if (options.includeSetXp) await this.xp.revoke(userId, 'set_logged', setId)
  }

  async onSessionCompleted(userId: string, sessionId: string, now: Date = new Date()): Promise<void> {
    await this.xp.award(userId, XP_SESSION_COMPLETE_BONUS, 'session_completed', sessionId)
    await this.evaluateAchievements(userId, now)
  }

  // A backdated session earns the completion bonus and can unlock achievements just like a live
  // one. Nothing here has to place it in a week: the derived streak reads sessions' started_at,
  // so it counts the day the workout actually happened on its own.
  async onPastSessionLogged(userId: string, sessionId: string): Promise<void> {
    await this.xp.award(userId, XP_SESSION_COMPLETE_BONUS, 'session_completed', sessionId)
    await this.evaluateAchievements(userId)
  }

  /**
   * The user's week streak, derived on every read from session history and the blocks that were
   * active at the time -- there is no stored counter, so there is nothing to drift, and a fixed
   * historical record always yields the same answer. See shared/lib/streak.ts for the rules.
   */
  async getStreak(userId: string, now: Date = new Date()): Promise<WeekStreak> {
    const currentWeekStart = startOfWeek(now).toISOString().slice(0, 10)
    const [schedules, completedDaysByWeek] = await Promise.all([
      this.blocks.findScheduleHistory(userId),
      this.sessions.completedDaysByWeek(userId),
    ])
    // buildStreakWeeks spans from the earliest trained week, so a user who has never trained
    // would get no weeks at all and no target to show. Seeding this week at zero starts the span
    // no later than now; the spread keeps the real counts where they exist.
    const weeks = buildStreakWeeks({
      schedules,
      completedDaysByWeek: { [currentWeekStart]: 0, ...completedDaysByWeek },
      currentWeekStart,
    })
    return computeWeekStreak(weeks, currentWeekStart)
  }

  /**
   * Returns every published achievement for the user, annotated with whether it's unlocked
   * and, if not, how close the user is to unlocking it. Reuses the exact same underlying facts
   * (streak, session count, PR count, total volume) that `evaluateAchievements` gathers to decide
   * unlocks, so progress shown to the user can never drift from progress used to unlock.
   */
  async getAchievementProgress(userId: string, now: Date = new Date()): Promise<AchievementWithProgress[]> {
    const facts = await this.gatherAchievementFacts(userId, now)

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
        return { current: facts.streak.current, target: achievement.criteriaValue.weeks as number, unit: 'weeks' }
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

  private async gatherAchievementFacts(userId: string, now: Date = new Date()): Promise<AchievementFacts> {
    const [published, unlockedKeys, streak, sessionCount, prCount, totalVolumeKg] = await Promise.all([
      this.achievements.findPublished(),
      this.achievements.findUnlockedKeys(userId),
      this.getStreak(userId, now),
      this.xp.countBySourceType(userId, 'session_completed'),
      this.xp.countBySourceType(userId, 'pr'),
      this.sessions.totalVolumeKg(userId),
    ])
    return { published, unlockedKeys, streak, sessionCount, prCount, totalVolumeKg }
  }

  private async evaluateAchievements(userId: string, now: Date = new Date()): Promise<void> {
    const facts = await this.gatherAchievementFacts(userId, now)

    for (const achievement of facts.published) {
      if (facts.unlockedKeys.includes(achievement.key)) continue

      let met = false
      switch (achievement.criteriaType) {
        case 'streak_length':
          met = facts.streak.current >= (achievement.criteriaValue.weeks as number)
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
