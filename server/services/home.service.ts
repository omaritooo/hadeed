import { BaseService } from '~~/server/services/base.service'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { StreakRepository } from '~~/server/repositories/streak.repository'
import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { PersonalRecordRepository } from '~~/server/repositories/personal-record.repository'
import type { AchievementRepository } from '~~/server/repositories/achievement.repository'
import type { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { ConsistencyDay, HomeSummary } from '~~/shared/types/home.types'
import type { SplitDay, SplitExercise } from '~~/shared/types/split.types'
import type { WorkoutsService } from '~~/server/services/workouts.service'
import { xpFloorForLevel, xpToLevel } from '~~/shared/lib/formulas'
import { startOfWeek, toSqliteDatetime } from '~~/server/utils/date'

const RECENT_PRS_LIMIT = 5
const RECENT_ACHIEVEMENTS_LIMIT = 3
const WEIGHT_TREND_POINTS = 10
const CONSISTENCY_DAYS = 28

type TrainingDay = SplitDay & { exercises: SplitExercise[] }

export class HomeService extends BaseService {
  constructor(
    ctx: RequestContext,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
    private streaks: StreakRepository,
    private xp: XpRepository,
    private personalRecords: PersonalRecordRepository,
    private achievements: AchievementRepository,
    private bodyMetrics: BodyMetricsRepository,
    private workouts: WorkoutsService,
  ) {
    super(ctx)
  }

  async getSummary(): Promise<HomeSummary> {
    const userId = this.ctx.userId
    const now = new Date()
    const todayIso = now.toISOString().slice(0, 10)
    const weekStart = startOfWeek(now)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7)

    const consistencyStart = new Date(now)
    consistencyStart.setUTCHours(0, 0, 0, 0)
    consistencyStart.setUTCDate(consistencyStart.getUTCDate() - (CONSISTENCY_DAYS - 1))
    const consistencyEnd = new Date(now)
    consistencyEnd.setUTCHours(0, 0, 0, 0)
    consistencyEnd.setUTCDate(consistencyEnd.getUTCDate() + 1)

    const [streak, xpTotal, activeBlock, activeSessionRow] = await Promise.all([
      this.streaks.findForUser(userId),
      this.xp.totalForUser(userId),
      this.blocks.findActiveForUser(userId, todayIso),
      this.sessions.findActiveForUser(userId),
    ])

    const trainingDays: TrainingDay[] = (activeBlock?.days.filter(day => !day.isRestDay) ?? [])
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)

    const [activeSession, todaysWorkout, weeklyTrainedDays, weeklyVolumeKg, recentSession, recentPrs, recentAchievements, bodyMetrics, trainedDates] = await Promise.all([
      this.workouts.buildActiveSession(activeSessionRow),
      this.workouts.buildTodaysWorkout(userId, trainingDays, activeSessionRow),
      this.sessions.countTrainedDaysInRange(userId, toSqliteDatetime(weekStart), toSqliteDatetime(weekEnd)),
      this.sessions.volumeKgInRange(userId, toSqliteDatetime(weekStart), toSqliteDatetime(weekEnd)),
      this.sessions.findMostRecentCompletedSummary(userId),
      this.personalRecords.recent(userId, RECENT_PRS_LIMIT),
      this.achievements.findRecentlyUnlocked(userId, RECENT_ACHIEVEMENTS_LIMIT),
      this.bodyMetrics.findForUser(userId),
      this.sessions.findTrainedDatesInRange(userId, toSqliteDatetime(consistencyStart), toSqliteDatetime(consistencyEnd)),
    ])

    const level = xpToLevel(xpTotal)
    const currentLevelFloor = xpFloorForLevel(level)
    const nextLevelFloor = xpFloorForLevel(level + 1)

    const weightTrend = bodyMetrics
      .slice(0, WEIGHT_TREND_POINTS)
      .reverse()
      .map(metric => ({ recordedAt: metric.recordedAt, weightKg: metric.weightKg }))

    const consistency: ConsistencyDay[] = Array.from({ length: CONSISTENCY_DAYS }, (_, i) => {
      const date = new Date(consistencyStart)
      date.setUTCDate(consistencyStart.getUTCDate() + i)
      const iso = date.toISOString().slice(0, 10)
      return { date: iso, active: trainedDates.has(iso) }
    })

    return {
      streak: { current: streak.currentStreak, longest: streak.longestStreak },
      xp: { total: xpTotal, level, xpIntoLevel: xpTotal - currentLevelFloor, xpForNextLevel: nextLevelFloor - currentLevelFloor },
      todaysWorkout,
      activeSession,
      weeklyProgress: { trainedDays: weeklyTrainedDays, scheduledDays: trainingDays.length, volumeKg: weeklyVolumeKg },
      recentSession,
      recentPrs,
      recentAchievements,
      weightTrend,
      consistency,
    }
  }
}
