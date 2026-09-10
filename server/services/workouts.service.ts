import { BaseService } from '~~/server/services/base.service'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { ActiveSessionSummary, TodaysWorkout } from '~~/shared/types/home.types'
import type { MuscleVolume, VolumeBand, WeeklyVolumeSnapshot, WorkoutsSummary } from '~~/shared/types/workouts.types'
import {
  WEEKLY_VOLUME_HIGH_THRESHOLD,
  WEEKLY_VOLUME_HISTORY_DEFAULT_WEEKS,
  WEEKLY_VOLUME_HISTORY_MAX_WEEKS,
  WEEKLY_VOLUME_LOW_THRESHOLD,
} from '~~/shared/types/workouts.types'
import type { WorkoutSession } from '~~/shared/types/session.types'
import type { SplitDay, SplitExercise } from '~~/shared/types/split.types'
import { startOfWeek, toSqliteDatetime } from '~~/server/utils/date'

const RECENT_SESSIONS_LIMIT = 5
const RECENT_PRS_LIMIT = 5
const WEEKLY_VOLUME_LIMIT = 8

type TrainingDay = SplitDay & { exercises: SplitExercise[] }

export class WorkoutsService extends BaseService {
  constructor(
    ctx: RequestContext,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
    private exercises: ExerciseRepository,
    private xp: XpRepository,
  ) {
    super(ctx)
  }

  async getSummary(): Promise<WorkoutsSummary> {
    const userId = this.ctx.userId
    const todayIso = new Date().toISOString().slice(0, 10)

    const [activeBlock, activeSessionRow] = await Promise.all([
      this.blocks.findActiveForUser(userId, todayIso),
      this.sessions.findActiveForUser(userId),
    ])

    const trainingDays: TrainingDay[] = (activeBlock?.days.filter(day => !day.isRestDay) ?? [])
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)

    const [activeSession, todaysWorkout, recentSessions, recentPrs] = await Promise.all([
      this.buildActiveSession(activeSessionRow),
      this.buildTodaysWorkout(userId, trainingDays, activeSessionRow),
      this.sessions.findRecentCompletedSummaries(userId, RECENT_SESSIONS_LIMIT),
      this.xp.recentPrs(userId, RECENT_PRS_LIMIT),
    ])

    return { todaysWorkout, activeSession, recentSessions, recentPrs }
  }

  async getWeeklyVolume(userId: string): Promise<MuscleVolume[]> {
    const weekStart = startOfWeek(new Date())
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7)

    const rows = await this.sessions.weeklySetsByMuscle(
      userId,
      toSqliteDatetime(weekStart),
      toSqliteDatetime(weekEnd),
    )

    return rows
      .map(row => ({ muscleName: row.muscleName, setCount: row.setCount, band: this.bandForSetCount(row.setCount) }))
      .slice(0, WEEKLY_VOLUME_LIMIT)
  }

  private bandForSetCount(setCount: number): VolumeBand {
    if (setCount < WEEKLY_VOLUME_LOW_THRESHOLD) return 'low'
    if (setCount > WEEKLY_VOLUME_HIGH_THRESHOLD) return 'high'
    return 'optimal'
  }

  // Historical counterpart to getWeeklyVolume: the same per-muscle set-count/banding, but across
  // the last `weeks` weeks (oldest first, so it plots left-to-right chronologically) instead of
  // just the current week, so the Stats tab can chart a volume trend per muscle.
  //
  // Decision: unlike getWeeklyVolume, this does NOT slice to WEEKLY_VOLUME_LIMIT (top 8 muscles).
  // That cap exists so the current-week "at a glance" widget shows only the most-trained muscles;
  // applying it per-week here would let a muscle drop in and out of different weeks' top-8,
  // breaking a continuous trend line for it. A muscle with zero sets in a given week simply has no
  // entry for that week (weeklySetsByMuscle only returns muscles with at least one set), which the
  // chart can treat as 0.
  //
  // Decision: reuses SessionRepository.weeklySetsByMuscle in a loop (one query per week) rather
  // than adding a new bulk/bucketed SQL query. `weeks` is small (<=12), so this is a handful of
  // cheap indexed queries, and it keeps the historical aggregation built entirely out of the
  // already-tested single-week method instead of duplicating its warm-up-exclusion/join logic in
  // a second, harder-to-verify date-bucketed query.
  async getWeeklyVolumeHistory(userId: string, weeks: number = WEEKLY_VOLUME_HISTORY_DEFAULT_WEEKS): Promise<WeeklyVolumeSnapshot[]> {
    const weekCount = !Number.isFinite(weeks) || weeks < 1
      ? WEEKLY_VOLUME_HISTORY_DEFAULT_WEEKS
      : Math.min(Math.trunc(weeks), WEEKLY_VOLUME_HISTORY_MAX_WEEKS)
    const currentWeekStart = startOfWeek(new Date())

    const weekStarts = Array.from({ length: weekCount }, (_, i) => {
      const weekStart = new Date(currentWeekStart)
      weekStart.setUTCDate(currentWeekStart.getUTCDate() - (weekCount - 1 - i) * 7)
      return weekStart
    })

    return Promise.all(weekStarts.map(async (weekStart) => {
      const weekEnd = new Date(weekStart)
      weekEnd.setUTCDate(weekStart.getUTCDate() + 7)

      const rows = await this.sessions.weeklySetsByMuscle(userId, toSqliteDatetime(weekStart), toSqliteDatetime(weekEnd))

      return {
        weekStart: weekStart.toISOString().slice(0, 10),
        muscles: rows.map(row => ({ muscleName: row.muscleName, setCount: row.setCount, band: this.bandForSetCount(row.setCount) })),
      }
    }))
  }

  async buildActiveSession(session: WorkoutSession | null): Promise<ActiveSessionSummary | null> {
    if (!session) return null
    const withLogs = await this.sessions.findWithLogs(session.id)
    const setsLogged = withLogs?.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) ?? 0
    return { sessionId: session.id, splitDayId: session.splitDayId, startedAt: session.startedAt, setsLogged }
  }

  async buildTodaysWorkout(
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

    const exerciseIds = day.exercises.map(exercise => exercise.exerciseId)
    const [exerciseDetails, lastPerformed] = await Promise.all([
      this.exercises.findByIds(exerciseIds),
      this.sessions.findLastPerformedForExercises(userId, exerciseIds),
    ])
    const detailsById = new Map(exerciseDetails.map(exercise => [exercise.id, exercise]))

    return {
      splitDayId: day.id,
      blockId: day.blockId,
      dayName: day.name,
      format: day.format,
      rounds: day.rounds,
      exercises: day.exercises.map((exercise) => {
        const details = detailsById.get(exercise.exerciseId)
        return {
          exerciseId: exercise.exerciseId,
          exerciseName: details?.name ?? exercise.exerciseId,
          splitExerciseId: exercise.id,
          position: exercise.position,
          setType: exercise.setType,
          targetSets: exercise.targetSets,
          targetReps: exercise.targetReps,
          targetRpe: exercise.targetRpe,
          restSeconds: exercise.restSeconds,
          thumbnailUrl: details?.images[0] ?? null,
          primaryMuscle: details?.primaryMuscles[0] ?? null,
          lastPerformed: lastPerformed[exercise.exerciseId] ?? null,
        }
      }),
    }
  }
}
