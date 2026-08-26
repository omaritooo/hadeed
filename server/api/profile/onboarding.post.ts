import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { TargetRepository } from '~~/server/repositories/target.repository'
import { ProfileService, type CompleteOnboardingInput } from '~~/server/services/profile.service'

interface OnboardingRequestBody extends Omit<CompleteOnboardingInput, 'height' | 'weight'> {
  height: number // cm if unitSystem is 'metric' (or unresolved/omitted), inches if 'imperial'
  weight: number // kg if unitSystem is 'metric' (or unresolved/omitted), lbs if 'imperial'
}

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as OnboardingRequestBody
  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db), new TargetRepository(db))

  const { height, weight, ...rest } = body
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(weight) || weight <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'height and weight must be positive numbers' })
  }

  const input: CompleteOnboardingInput = { ...rest, height, weight }

  await service.completeOnboarding(input)
  return service.getProfile()
})
