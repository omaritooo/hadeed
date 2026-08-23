import { BaseService } from '~~/server/services/base.service'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import type { UserRepository } from '~~/server/repositories/user.repository'
import { bmi, tdee } from '~~/shared/lib/formulas'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { ActivityLevel, Gender } from '~~/shared/lib/formulas'
import type { Equipment } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal, UnitSystem } from '~~/shared/types/profile.types'

export interface CompleteOnboardingInput {
  displayName?: string
  dateOfBirth: string
  gender: Gender
  heightCm: number
  weightKg: number
  activityLevel?: ActivityLevel
  experienceLevel?: ExperienceLevel
  primaryGoal?: Goal
  trainingDaysPerWeek?: number
  equipment?: Equipment
  unitSystem?: UnitSystem
  timezone?: string
}

function ageFromDob(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth)
  const diffMs = Date.now() - dob.getTime()
  return Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000))
}

export class ProfileService extends BaseService {
  constructor(
    ctx: RequestContext,
    private profiles: ProfileRepository,
    private bodyMetrics: BodyMetricsRepository,
    private users: UserRepository,
  ) {
    super(ctx)
  }

  async completeOnboarding(input: CompleteOnboardingInput): Promise<void> {
    await this.profiles.upsert(this.ctx.userId, {
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      heightCm: input.heightCm,
      activityLevel: input.activityLevel ?? null,
      experienceLevel: input.experienceLevel ?? null,
      primaryGoal: input.primaryGoal ?? null,
      trainingDaysPerWeek: input.trainingDaysPerWeek ?? null,
      equipment: input.equipment ?? null,
      unitSystem: input.unitSystem,
      timezone: input.timezone ?? null,
    })
    await this.bodyMetrics.record(this.ctx.userId, {
      recordedAt: new Date().toISOString().slice(0, 10),
      weightKg: input.weightKg,
      source: 'manual',
      measurements: [],
    })
    if (input.displayName !== undefined) {
      await this.users.updateDisplayName(this.ctx.userId, input.displayName)
    }
  }

  async getProfile() {
    const profile = await this.profiles.findByUserId(this.ctx.userId)
    if (!profile) return null
    const displayName = await this.users.findDisplayName(this.ctx.userId)
    return { ...profile, displayName }
  }

  async getComputedStats(): Promise<{ bmi: number, tdee: number | null } | null> {
    const profile = await this.profiles.findByUserId(this.ctx.userId)
    if (!profile) return null

    const metrics = await this.bodyMetrics.findForUser(this.ctx.userId)
    const latestMetric = metrics[0]
    if (!latestMetric) return null

    const bmiValue = bmi({ weightKg: latestMetric.weightKg, heightCm: profile.heightCm })
    const tdeeValue = profile.activityLevel
      ? tdee({
          weightKg: latestMetric.weightKg,
          heightCm: profile.heightCm,
          age: ageFromDob(profile.dateOfBirth),
          gender: profile.gender,
          activityLevel: profile.activityLevel,
        })
      : null

    return { bmi: bmiValue, tdee: tdeeValue }
  }
}
