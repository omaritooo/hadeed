import { BaseService } from '~~/server/services/base.service'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import type { UserRepository } from '~~/server/repositories/user.repository'
import type { TargetRepository } from '~~/server/repositories/target.repository'
import { bmi, lbsToKg, round1, tdee } from '~~/shared/lib/formulas'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { ActivityLevel, Gender } from '~~/shared/lib/formulas'
import type { Equipment } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal, UnitSystem } from '~~/shared/types/profile.types'
import { hashPassword } from '~~/server/utils/password'

export interface CompleteOnboardingInput {
  email: string
  password: string
  displayName?: string
  dateOfBirth: string
  gender: Gender
  height: number
  weight: number
  targetWeight?: number
  activityLevel?: ActivityLevel
  experienceLevel?: ExperienceLevel
  primaryGoal?: Goal
  trainingDaysPerWeek?: number
  equipment?: Equipment
  unitSystem?: UnitSystem
  timezone?: string
}

const ageFromDob = (dateOfBirth: string): number => {
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
    private targets: TargetRepository,
  ) {
    super(ctx)
  }

  async completeOnboarding(input: CompleteOnboardingInput): Promise<void> {
    const passwordHash = await hashPassword(input.password)
    await this.users.ensureExists(this.ctx.userId, input.email, passwordHash, input.displayName)

    const profile = await this.profiles.upsert(this.ctx.userId, {
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      height: input.height,
      activityLevel: input.activityLevel,
      experienceLevel: input.experienceLevel,
      primaryGoal: input.primaryGoal,
      trainingDaysPerWeek: input.trainingDaysPerWeek,
      equipment: input.equipment,
      unitSystem: input.unitSystem,
      timezone: input.timezone,
    })
    const weightKg = profile.unitSystem === 'imperial' ? round1(lbsToKg(input.weight)) : round1(input.weight)
    const recordedAt = new Date().toISOString().slice(0, 10)
    await this.bodyMetrics.record(this.ctx.userId, {
      recordedAt,
      weightKg,
      source: 'manual',
      measurements: [],
    })
    if (input.displayName !== undefined) {
      await this.users.updateDisplayName(this.ctx.userId, input.displayName)
    }
    if (input.targetWeight !== undefined) {
      const targetWeightKg = profile.unitSystem === 'imperial' ? round1(lbsToKg(input.targetWeight)) : round1(input.targetWeight)
      const existingTargets = await this.targets.findActiveForUser(this.ctx.userId)
      const hasActiveWeightTarget = existingTargets.some(target => target.metric === 'weight')
      if (!hasActiveWeightTarget) {
        await this.targets.create(this.ctx.userId, {
          metric: 'weight',
          targetValue: targetWeightKg,
          startingValue: weightKg,
          startingRecordedAt: recordedAt,
        })
      }
    }
  }

  async getProfile() {
    const profile = await this.profiles.findByUserId(this.ctx.userId)
    if (!profile) return null
    const displayName = await this.users.findDisplayName(this.ctx.userId)
    const targets = await this.targets.findActiveForUser(this.ctx.userId)
    return { ...profile, displayName, targets }
  }

  async getComputedStats(): Promise<{ bmi: number, tdee: number | null, latestWeightKg: number } | null> {
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

    return { bmi: bmiValue, tdee: tdeeValue, latestWeightKg: latestMetric.weightKg }
  }
}
