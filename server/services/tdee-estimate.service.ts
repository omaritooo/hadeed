import { BaseService } from '~~/server/services/base.service'
import type { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import type { MealLogRepository } from '~~/server/repositories/meal-log.repository'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { ProfileService } from '~~/server/services/profile.service'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { TdeeEstimateResponse } from '~~/shared/types/nutrition.types'
import { estimateTdee, WINDOW_DAYS } from '~~/shared/lib/adaptive-tdee'
import { suggestNutritionTarget } from '~~/shared/lib/nutrition-targets'
import { fromSqliteDatetime, toSqliteDatetime } from '~~/server/utils/date'

const SUGGEST_THRESHOLD_KCAL = 150
const DISMISS_SNOOZE_DAYS = 14

const isoDay = (date: Date, offsetDays = 0) => {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export class TdeeEstimateService extends BaseService {
  constructor(
    ctx: RequestContext,
    private profiles: ProfileRepository,
    private bodyMetrics: BodyMetricsRepository,
    private mealLogs: MealLogRepository,
    // Only the formula TDEE is needed; typed narrowly so tests don't build a whole ProfileService.
    private stats: Pick<ProfileService, 'getComputedStats'>,
  ) {
    super(ctx)
  }

  async getEstimate(now: Date = new Date()): Promise<TdeeEstimateResponse> {
    const userId = this.ctx.userId
    const start = isoDay(now, -WINDOW_DAYS)
    const today = isoDay(now)
    const tomorrow = isoDay(now, 1)

    const [profile, computed, dailyIntake, weighIns] = await Promise.all([
      this.profiles.findByUserId(userId),
      this.stats.getComputedStats(),
      // Today is still being logged: a half-logged day that clears the incomplete-day filter
      // would drag the average down, so intake covers the 28 finished days before today.
      this.mealLogs.dailyCaloriesInRange(userId, start, today),
      this.bodyMetrics.findWeightsInRange(userId, start, tomorrow),
    ])

    const currentTarget = profile?.nutritionTarget ?? null
    const estimate = estimateTdee({ dailyIntake, weighIns, formulaTdee: computed?.tdee ?? null, calorieTarget: currentTarget?.calories ?? null })

    if (estimate.status !== 'ready' || !profile?.primaryGoal) {
      return { ...estimate, suggestedTarget: null, shouldSuggest: false }
    }

    const suggestedTarget = suggestNutritionTarget({ tdee: estimate.estimate, goal: profile.primaryGoal })
    const differsEnough = currentTarget === null || Math.abs(suggestedTarget.calories - currentTarget.calories) >= SUGGEST_THRESHOLD_KCAL
    const dismissedAt = profile.tdeeSuggestionDismissedAt ? fromSqliteDatetime(profile.tdeeSuggestionDismissedAt) : null
    const snoozed = dismissedAt !== null && now.getTime() - dismissedAt.getTime() < DISMISS_SNOOZE_DAYS * 86_400_000

    return { ...estimate, suggestedTarget, shouldSuggest: differsEnough && !snoozed }
  }

  async dismiss(now: Date = new Date()): Promise<void> {
    await this.profiles.setTdeeSuggestionDismissedAt(this.ctx.userId, toSqliteDatetime(now))
  }
}
