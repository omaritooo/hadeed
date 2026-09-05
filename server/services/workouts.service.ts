import { BaseService } from '~~/server/services/base.service'
import type { SessionRepository } from '~~/server/repositories/session.repository'
import type { BlockRepository } from '~~/server/repositories/block.repository'
import type { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import type { XpRepository } from '~~/server/repositories/xp.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { ActiveSessionSummary, TodaysWorkout } from '~~/shared/types/home.types'
import type { WorkoutsSummary } from '~~/shared/types/workouts.types'
import type { WorkoutSession } from '~~/shared/types/session.types'
import type { SplitDay, SplitExercise } from '~~/shared/types/split.types'

const RECENT_SESSIONS_LIMIT = 5
const RECENT_PRS_LIMIT = 5

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

    const names = await this.exercises.findNamesByIds(day.exercises.map(exercise => exercise.exerciseId))
    return {
      splitDayId: day.id,
      blockId: day.blockId,
      dayName: day.name,
      exercises: day.exercises.map(exercise => ({
        exerciseId: exercise.exerciseId,
        exerciseName: names[exercise.exerciseId] ?? exercise.exerciseId,
        splitExerciseId: exercise.id,
        position: exercise.position,
        setType: exercise.setType,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        targetRpe: exercise.targetRpe,
      })),
    }
  }
}
