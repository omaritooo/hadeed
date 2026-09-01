import { randomUUID } from 'node:crypto'
import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { TargetRepository } from '~~/server/repositories/target.repository'
import { AuthSessionRepository } from '~~/server/repositories/auth-session.repository'
import { ProfileService, type CompleteOnboardingInput } from '~~/server/services/profile.service'
import { setSessionCookie } from '~~/server/utils/session-cookie'
import type { RequestContext } from '~~/shared/types/rbac.types'

interface OnboardingRequestBody extends Omit<CompleteOnboardingInput, 'height' | 'weight'> {
  height: number
  weight: number
}

const isUniqueConstraintError = (err: unknown): boolean => {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message)
}

defineRouteMeta({
  openAPI: {
    summary: 'Complete onboarding (signup)',
    description: 'Creates the user and profile in one step, then logs the new user in. This is the app\'s signup flow.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'password', 'dateOfBirth', 'gender', 'height', 'weight'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string' },
              displayName: { type: 'string' },
              dateOfBirth: { type: 'string', format: 'date' },
              gender: { type: 'string', enum: ['male', 'female'] },
              height: { type: 'number', description: 'cm if unitSystem is metric (or omitted), inches if imperial' },
              weight: { type: 'number', description: 'kg if unitSystem is metric (or omitted), lbs if imperial' },
              targetWeight: { type: 'number', description: 'same unit as weight' },
              activityLevel: { type: 'string', enum: ['sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extremely_active'] },
              experienceLevel: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
              primaryGoal: { type: 'string', enum: ['fat_loss', 'muscle_gain', 'maintenance', 'general_fitness'] },
              trainingDaysPerWeek: { type: 'number' },
              equipment: { type: 'string', enum: ['gym', 'home', 'both'] },
              unitSystem: { type: 'string', enum: ['metric', 'imperial'] },
              timezone: { type: 'string' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Newly created profile' },
      400: { description: 'email/password missing, or height/weight not positive numbers' },
      409: { description: 'An account with this email already exists' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as OnboardingRequestBody
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'email and password are required' })
  }

  const db = useDb()
  const users = new UserRepository(db)

  const existing = await users.findByEmail(body.email)
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'An account with this email already exists' })
  }

  const { height, weight, ...rest } = body
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(weight) || weight <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'height and weight must be positive numbers' })
  }

  const userId = randomUUID()
  const ctx: RequestContext = { userId, roles: [], permissions: [] }
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), users, new TargetRepository(db))

  const input: CompleteOnboardingInput = { ...rest, height, weight }
  try {
    await service.completeOnboarding(input)
  } catch (err) {
    try {
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [userId] })
    } catch (cleanupErr) {
      console.error(`onboarding: failed to clean up ghost users row ${userId} after signup failure`, err, cleanupErr)
    }

    if (isUniqueConstraintError(err)) {
      throw createError({ statusCode: 409, statusMessage: 'An account with this email already exists' })
    }
    throw err
  }

  const session = await new AuthSessionRepository(db).create(userId)
  setSessionCookie(event, session.id, { persist: true })

  return service.getProfile()
})
