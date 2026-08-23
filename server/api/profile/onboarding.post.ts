import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { ProfileService, type CompleteOnboardingInput } from '~~/server/services/profile.service'
import { inToCm, lbsToKg } from '~~/shared/lib/formulas'

interface OnboardingRequestBody extends Omit<CompleteOnboardingInput, 'heightCm' | 'weightKg'> {
  height: number // cm if unitSystem is 'metric' (or omitted), inches if 'imperial'
  weight: number // kg if unitSystem is 'metric' (or omitted), lbs if 'imperial'
}

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as OnboardingRequestBody
  const db = useDb()
  const profileRepo = new ProfileRepository(db)
  const service = new ProfileService(ctx, profileRepo, new BodyMetricsRepository(db), new UserRepository(db))

  const { height, weight, ...rest } = body
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(weight) || weight <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'height and weight must be positive numbers' })
  }
  // The unit system for interpreting the raw height/weight numbers must not be trusted from
  // the current request body alone: the repository preserves the previously stored unit_system
  // when a follow-up call omits it, so a client relying on that preservation (e.g. resubmitting
  // fresh imperial numbers without repeating unitSystem) would otherwise have those numbers
  // misread as metric. Resolve the effective unit system from the stored profile first.
  const existingProfile = await profileRepo.findByUserId(ctx.userId)
  const effectiveUnitSystem = body.unitSystem ?? existingProfile?.unitSystem ?? 'metric'
  const isImperial = effectiveUnitSystem === 'imperial'
  // Rounded to 1 decimal unconditionally, not just on the imperial-converted path — an
  // imperial input needs it to avoid inToCm/lbsToKg's raw floating-point tail reaching
  // storage, and applying the same rounding to metric input keeps heightCm/weightKg at a
  // uniform precision regardless of which branch produced them, rather than one path being
  // exact-as-typed and the other quietly noisier.
  const input: CompleteOnboardingInput = {
    ...rest,
    unitSystem: effectiveUnitSystem,
    heightCm: Math.round((isImperial ? inToCm(height) : height) * 10) / 10,
    weightKg: Math.round((isImperial ? lbsToKg(weight) : weight) * 10) / 10,
  }

  await service.completeOnboarding(input)
  return service.getProfile()
})
