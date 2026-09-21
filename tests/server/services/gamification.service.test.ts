import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { GamificationService } from '~~/server/services/gamification.service'

describe('GamificationService', () => {
  let db: Client
  let service: GamificationService
  let achievements: AchievementRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    achievements = new AchievementRepository(db)
    service = new GamificationService(
      new XpRepository(db),
      new StreakRepository(db),
      achievements,
      new SessionRepository(db),
    )
  })

  it('awards xp for a logged set', async () => {
    await service.onSetLogged('user-1', 'set-1')
    expect(await new XpRepository(db).totalForUser('user-1')).toBeGreaterThan(0)
  })

  it('unlocks a streak_length achievement once the streak reaches its threshold', async () => {
    await achievements.create({
      key: 'week-streak', name: '7-Day Streak', description: null, icon: null,
      criteriaType: 'streak_length', criteriaValue: { days: 2 }, isPublished: true,
    })

    await service.onSessionCompleted('user-1', 'session-1', { scheduledDaysThisWeek: 5, completedDaysThisWeek: 5 })
    let unlocked = await achievements.findUnlockedKeys('user-1')
    expect(unlocked).not.toContain('week-streak')

    await service.onSessionCompleted('user-1', 'session-2', { scheduledDaysThisWeek: 5, completedDaysThisWeek: 5 })
    unlocked = await achievements.findUnlockedKeys('user-1')
    expect(unlocked).toContain('week-streak')
  })

  it('does not increment the streak when a scheduled day was missed', async () => {
    await service.onSessionCompleted('user-1', 'session-1', { scheduledDaysThisWeek: 5, completedDaysThisWeek: 1, missedScheduledDay: true })
    const streak = await new StreakRepository(db).findForUser('user-1')
    expect(streak.currentStreak).toBe(0)
  })

  it('leaves the streak unchanged for a mid-week session (partial completion, nothing missed yet)', async () => {
    await service.onSessionCompleted('user-1', 'session-1', { scheduledDaysThisWeek: 5, completedDaysThisWeek: 1 })
    const streak = await new StreakRepository(db).findForUser('user-1')
    expect(streak.currentStreak).toBe(0)
    expect(streak.longestStreak).toBe(0)
  })

  describe('getAchievementProgress', () => {
    it('reports progress toward a locked achievement using the same facts evaluateAchievements uses to unlock it', async () => {
      await achievements.create({
        key: 'week-streak', name: '7-Day Streak', description: 'desc', icon: '🔥',
        criteriaType: 'streak_length', criteriaValue: { days: 7 }, isPublished: true,
      })

      await service.onSessionCompleted('user-1', 'session-1', { scheduledDaysThisWeek: 1, completedDaysThisWeek: 1 })

      const progress = await service.getAchievementProgress('user-1')
      const weekStreak = progress.find(a => a.key === 'week-streak')
      expect(weekStreak).toEqual({
        key: 'week-streak',
        name: '7-Day Streak',
        description: 'desc',
        icon: '🔥',
        criteriaType: 'streak_length',
        unlocked: false,
        progress: { current: 1, target: 7, unit: 'days' },
      })
    })

    it('reports an achievement as unlocked with no progress once its threshold is met, matching findUnlockedKeys', async () => {
      await achievements.create({
        key: 'week-streak', name: '7-Day Streak', description: null, icon: null,
        criteriaType: 'streak_length', criteriaValue: { days: 1 }, isPublished: true,
      })

      await service.onSessionCompleted('user-1', 'session-1', { scheduledDaysThisWeek: 1, completedDaysThisWeek: 1 })

      const progress = await service.getAchievementProgress('user-1')
      const weekStreak = progress.find(a => a.key === 'week-streak')
      expect(weekStreak?.unlocked).toBe(true)
      expect(weekStreak?.progress).toBeNull()

      const unlockedKeys = await achievements.findUnlockedKeys('user-1')
      expect(unlockedKeys).toContain('week-streak')
    })

    it('computes progress for session_count, pr_count, and total_volume_kg achievements', async () => {
      await achievements.create({
        key: 'ten-sessions', name: 'Regular', description: null, icon: null,
        criteriaType: 'session_count', criteriaValue: { count: 10 }, isPublished: true,
      })
      await achievements.create({
        key: 'five-prs', name: 'PR Club', description: null, icon: null,
        criteriaType: 'pr_count', criteriaValue: { count: 5 }, isPublished: true,
      })
      await achievements.create({
        key: 'lifted-a-car', name: 'Lifted a Car', description: null, icon: null,
        criteriaType: 'total_volume_kg', criteriaValue: { kg: 1500 }, isPublished: true,
      })

      await service.onSessionCompleted('user-1', 'session-1', { scheduledDaysThisWeek: 1, completedDaysThisWeek: 1 })
      await service.onPrHit('user-1', 'pr-1')

      const progress = await service.getAchievementProgress('user-1')
      expect(progress.find(a => a.key === 'ten-sessions')?.progress).toEqual({ current: 1, target: 10, unit: 'sessions' })
      expect(progress.find(a => a.key === 'five-prs')?.progress).toEqual({ current: 1, target: 5, unit: 'PRs' })
      expect(progress.find(a => a.key === 'lifted-a-car')?.progress).toEqual({ current: 0, target: 1500, unit: 'kg' })
    })
  })

  it('awards session XP for a past session without touching the streak', async () => {
    const xp = new XpRepository(db)
    const streaks = new StreakRepository(db)
    const before = await streaks.findForUser('user-1')

    await service.onPastSessionLogged('user-1', 'past-1')

    expect(await xp.countBySourceType('user-1', 'session_completed')).toBe(1)
    expect(await streaks.findForUser('user-1')).toEqual(before)
  })
})
