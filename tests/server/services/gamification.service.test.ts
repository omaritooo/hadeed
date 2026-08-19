import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { StreakRepository } from '~~/server/repositories/streak.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
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

    // Each call represents a separate week's final session, fully completing
    // that week's schedule (completedDaysThisWeek === scheduledDaysThisWeek) —
    // that's what advances the streak by one. A session logged mid-week
    // (partial completion) intentionally would NOT advance it; see the
    // "leaves the streak unchanged mid-week" test below.
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
})
