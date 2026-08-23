import { readBody } from 'h3'
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
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db))

  const { height, weight, ...rest } = body
  const isImperial = body.unitSystem === 'imperial'
  const input: CompleteOnboardingInput = {
    ...rest,
    heightCm: Math.round((isImperial ? inToCm(height) : height) * 10) / 10,
    weightKg: Math.round((isImperial ? lbsToKg(weight) : weight) * 10) / 10,
  }

  await service.completeOnboarding(input)
  return service.getProfile()
})
