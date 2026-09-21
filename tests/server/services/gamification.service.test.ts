import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { XpRepository } from '~~/server/repositories/xp.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { SessionRepository } from '~~/server/repositories/session.repository'
import { BlockRepository } from '~~/server/repositories/block.repository'
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
      achievements,
      new SessionRepository(db),
      new BlockRepository(db),
    )
  })

  const seedBlock = (trainingDays: number) => new BlockRepository(db).createWithDays('user-1', {
    programId: null, name: 'Block', startDate: '2020-01-01', endDate: null, trainingDayMacroTarget: null, restDayMacroTarget: null,
    days: Array.from({ length: trainingDays }, (_, i) => ({ name: `Day ${i}`, dayOfWeek: i, location: 'gym' as const, exercises: [] })),
  })

  const completeOn = async (id: string, startedAt: string) => {
    const sessions = new SessionRepository(db)
    await sessions.startSession('user-1', { id, splitDayId: null, exercises: [] })
    await sessions.completeSession(id, 1)
    await db.execute({ sql: 'UPDATE workout_sessions SET started_at = ? WHERE id = ?', args: [startedAt, id] })
  }

  it('awards xp for a logged set', async () => {
    await service.onSetLogged('user-1', 'set-1')
    expect(await new XpRepository(db).totalForUser('user-1')).toBeGreaterThan(0)
  })

  describe('getStreak', () => {
    it('derives the streak from completed sessions and the block schedule', async () => {
      await seedBlock(2)
      await completeOn('a', '2026-08-24 09:00:00')
      await completeOn('b', '2026-08-31 09:00:00')

      const streak = await service.getStreak('user-1', new Date('2026-09-08T12:00:00Z'))

      expect(streak).toEqual({ current: 2, longest: 2, thisWeek: { completed: 0, required: 1, scheduled: 2 } })
    })

    it('reports this week\'s requirement from the active block before any training', async () => {
      await seedBlock(4)
      expect((await service.getStreak('user-1', new Date('2026-09-08T12:00:00Z'))).thisWeek)
        .toEqual({ completed: 0, required: 3, scheduled: 4 })
    })

    // A user between splits still has history worth reading: the week neither counts nor breaks,
    // and nothing here should blow up on the missing block.
    it('reports a neutral week for a user with no block at all', async () => {
      await completeOn('a', '2026-08-24 09:00:00')

      const streak = await service.getStreak('user-1', new Date('2026-09-08T12:00:00Z'))

      expect(streak).toEqual({ current: 0, longest: 0, thisWeek: { completed: 0, required: 0, scheduled: 0 } })
    })
  })

  it('unlocks a streak_length achievement from the derived week streak', async () => {
    await achievements.create({
      key: 'week-streak', name: 'Two Weeks', description: null, icon: null,
      criteriaType: 'streak_length', criteriaValue: { weeks: 2 }, isPublished: true,
    })
    await seedBlock(1)

    await completeOn('a', '2026-08-24 09:00:00')
    await service.onSessionCompleted('user-1', 'a', new Date('2026-08-25T12:00:00Z'))
    expect(await achievements.findUnlockedKeys('user-1')).not.toContain('week-streak')

    await completeOn('c', '2026-08-31 09:00:00')
    await service.onSessionCompleted('user-1', 'c', new Date('2026-09-02T12:00:00Z'))
    expect(await achievements.findUnlockedKeys('user-1')).toContain('week-streak')
  })

  describe('getAchievementProgress', () => {
    it('reports progress toward a locked achievement using the same facts evaluateAchievements uses to unlock it', async () => {
      await achievements.create({
        key: 'week-streak', name: 'Seven Weeks', description: 'desc', icon: '🔥',
        criteriaType: 'streak_length', criteriaValue: { weeks: 7 }, isPublished: true,
      })
      await seedBlock(1)
      await completeOn('session-1', '2026-09-07 09:00:00')

      const progress = await service.getAchievementProgress('user-1', new Date('2026-09-08T12:00:00Z'))
      const weekStreak = progress.find(a => a.key === 'week-streak')
      expect(weekStreak).toEqual({
        key: 'week-streak',
        name: 'Seven Weeks',
        description: 'desc',
        icon: '🔥',
        criteriaType: 'streak_length',
        unlocked: false,
        progress: { current: 1, target: 7, unit: 'weeks' },
      })
    })

    it('reports an achievement as unlocked with no progress once its threshold is met, matching findUnlockedKeys', async () => {
      await achievements.create({
        key: 'week-streak', name: 'One Week', description: null, icon: null,
        criteriaType: 'streak_length', criteriaValue: { weeks: 1 }, isPublished: true,
      })
      await seedBlock(1)
      await completeOn('session-1', '2026-09-07 09:00:00')
      await service.onSessionCompleted('user-1', 'session-1', new Date('2026-09-08T12:00:00Z'))

      const progress = await service.getAchievementProgress('user-1', new Date('2026-09-08T12:00:00Z'))
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

      await service.onSessionCompleted('user-1', 'session-1', new Date('2026-09-08T12:00:00Z'))
      await service.onPrHit('user-1', 'pr-1')

      const progress = await service.getAchievementProgress('user-1', new Date('2026-09-08T12:00:00Z'))
      expect(progress.find(a => a.key === 'ten-sessions')?.progress).toEqual({ current: 1, target: 10, unit: 'sessions' })
      expect(progress.find(a => a.key === 'five-prs')?.progress).toEqual({ current: 1, target: 5, unit: 'PRs' })
      expect(progress.find(a => a.key === 'lifted-a-car')?.progress).toEqual({ current: 0, target: 1500, unit: 'kg' })
    })
  })

  // A backdated log earns the completion bonus like any other, and the derived streak picks its
  // day up from started_at rather than from when it was entered.
  it('awards session XP for a past session, whose day the derived streak counts', async () => {
    await seedBlock(1)
    await completeOn('past-1', '2026-08-31 09:00:00')

    await service.onPastSessionLogged('user-1', 'past-1')

    expect(await new XpRepository(db).countBySourceType('user-1', 'session_completed')).toBe(1)
    expect((await service.getStreak('user-1', new Date('2026-09-08T12:00:00Z'))).current).toBe(1)
  })
})
