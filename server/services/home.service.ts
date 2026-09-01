import { BaseService } from '~~/server/services/base.service'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { StreakRepository } from '~~/server/repositories/streak.repository'
import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { AchievementRepository } from '~~/server/repositories/achievement.repository'
import type { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import type { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { ActiveSessionSummary, HomeSummary, TodaysWorkout } from '~~/shared/types/home.types'
import type { WorkoutSession } from '~~/shared/types/session.types'
import type { SplitDay, SplitExercise } from '~~/shared/types/split.types'
import { xpFloorForLevel, xpToLevel } from '~~/shared/lib/formulas'
import { startOfWeek, toSqliteDatetime } from '~~/server/utils/date'

const RECENT_PRS_LIMIT = 5
const RECENT_ACHIEVEMENTS_LIMIT = 3
const WEIGHT_TREND_POINTS = 10

type TrainingDay = SplitDay & { exercises: SplitExercise[] }

export class HomeService extends BaseService {
  constructor(
    ctx: RequestContext,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
    private streaks: StreakRepository,
    private xp: XpRepository,
    private achievements: AchievementRepository,
    private exercises: ExerciseRepository,
    private bodyMetrics: BodyMetricsRepository,
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

    const [streak, xpTotal, activeBlock, activeSessionRow] = await Promise.all([
      this.streaks.findForUser(userId),
      this.xp.totalForUser(userId),
      this.blocks.findActiveForUser(userId, todayIso),
      this.sessions.findActiveForUser(userId),
    ])

    const trainingDays: TrainingDay[] = (activeBlock?.days.filter(day => !day.isRestDay) ?? [])
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)

    const [activeSession, todaysWorkout, weeklyTrainedDays, weeklyVolumeKg, recentSession, recentPrs, recentAchievements, bodyMetrics] = await Promise.all([
      this.buildActiveSession(activeSessionRow),
      this.buildTodaysWorkout(userId, trainingDays, activeSessionRow),
      this.sessions.countTrainedDaysInRange(userId, toSqliteDatetime(weekStart), toSqliteDatetime(weekEnd)),
      this.sessions.volumeKgInRange(userId, toSqliteDatetime(weekStart), toSqliteDatetime(weekEnd)),
      this.sessions.findMostRecentCompletedSummary(userId),
      this.xp.recentPrs(userId, RECENT_PRS_LIMIT),
      this.achievements.findRecentlyUnlocked(userId, RECENT_ACHIEVEMENTS_LIMIT),
      this.bodyMetrics.findForUser(userId),
    ])

    const level = xpToLevel(xpTotal)
    const currentLevelFloor = xpFloorForLevel(level)
    const nextLevelFloor = xpFloorForLevel(level + 1)

    const weightTrend = bodyMetrics
      .slice(0, WEIGHT_TREND_POINTS)
      .reverse()
      .map(metric => ({ recordedAt: metric.recordedAt, weightKg: metric.weightKg }))

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
    }
  }

  private async buildActiveSession(session: WorkoutSession | null): Promise<ActiveSessionSummary | null> {
    if (!session) return null
    const withLogs = await this.sessions.findWithLogs(session.id)
    const setsLogged = withLogs?.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) ?? 0
    return { sessionId: session.id, splitDayId: session.splitDayId, startedAt: session.startedAt, setsLogged }
  }

  private async buildTodaysWorkout(
    userId: string,
    trainingDays: TrainingDay[],
    activeSession: WorkoutSession | null,
  ): Promise<TodaysWorkout | null> {
    if (trainingDays.length === 0) return null

    let day = activeSession?.splitDayId ? trainingDays.find(d => d.id === activeSession.splitDayId) : undefined
    if (!day) {
      const lastSplitDayId = await this.sessions.findMostRecentSplitDayId(userId, trainingDays.map(d => d.id))
      const lastIndex = lastSplitDayId ? trainingDays.findIndex(d => d.id === lastSplitDayId) : -1
      day = trainingDays[(lastIndex + 1) % trainingDays.length]
    }
    if (!day) return null

    const names = await this.exercises.findNamesByIds(day.exercises.map(exercise => exercise.exerciseId))
    return {
      splitDayId: day.id,
      blockId: day.blockId,
      dayName: day.name,
      exercises: day.exercises.map(exercise => ({
        exerciseId: exercise.exerciseId,
        exerciseName: names[exercise.exerciseId] ?? exercise.exerciseId,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
      })),
    }
  }
}
