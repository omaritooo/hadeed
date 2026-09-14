import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ProfileRepository } from '~~/server/repositories/profile.repository'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { UserRepository } from '~~/server/repositories/user.repository'
import { TargetRepository } from '~~/server/repositories/target.repository'
import { UserLimitationRepository } from '~~/server/repositories/user-limitation.repository'
import { ProfileService } from '~~/server/services/profile.service'

// Equipment intentionally includes 'both' here even though it's never a valid
// user_profiles.equipment value (see ProfileService.updatePreferences) - the
// request body isn't schema-gated beyond this list, so a caller can legitimately
// send 'both' and rely on the service's remap rather than getting a 400 for it.
const EQUIPMENT_VALUES = ['full_gym', 'home_barbell_dumbbell', 'home_dumbbell_only', 'bodyweight', 'both'] as const
const GOAL_VALUES = ['fat_loss', 'muscle_gain', 'maintenance', 'general_fitness', 'mobility'] as const
const EXPERIENCE_VALUES = ['beginner', 'intermediate', 'advanced'] as const
const UNIT_SYSTEM_VALUES = ['metric', 'imperial'] as const

type Equipment = typeof EQUIPMENT_VALUES[number]
type Goal = typeof GOAL_VALUES[number]
type ExperienceLevel = typeof EXPERIENCE_VALUES[number]
type UnitSystem = typeof UNIT_SYSTEM_VALUES[number]

interface PreferencesRequestBody {
  equipment: unknown
  primaryGoal: unknown
  experienceLevel: unknown
  unitSystem: unknown
}

defineRouteMeta({
  openAPI: {
    summary: 'Update the current user\'s training preferences',
    description: 'Updates equipment, primary goal, experience level, and unit system directly on the existing user_profiles row.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['equipment', 'primaryGoal', 'experienceLevel', 'unitSystem'],
            properties: {
              equipment: { type: 'string', enum: [...EQUIPMENT_VALUES] },
              primaryGoal: { type: 'string', enum: [...GOAL_VALUES] },
              experienceLevel: { type: 'string', enum: [...EXPERIENCE_VALUES] },
              unitSystem: { type: 'string', enum: [...UNIT_SYSTEM_VALUES] },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Preferences updated' },
      400: { description: 'One of the fields is missing or not a recognized value' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as PreferencesRequestBody

  if (typeof body.equipment !== 'string' || !EQUIPMENT_VALUES.includes(body.equipment as Equipment)) {
    throw createError({ statusCode: 400, statusMessage: 'equipment must be one of: ' + EQUIPMENT_VALUES.join(', ') })
  }
  if (typeof body.primaryGoal !== 'string' || !GOAL_VALUES.includes(body.primaryGoal as Goal)) {
    throw createError({ statusCode: 400, statusMessage: 'primaryGoal must be one of: ' + GOAL_VALUES.join(', ') })
  }
  if (typeof body.experienceLevel !== 'string' || !EXPERIENCE_VALUES.includes(body.experienceLevel as ExperienceLevel)) {
    throw createError({ statusCode: 400, statusMessage: 'experienceLevel must be one of: ' + EXPERIENCE_VALUES.join(', ') })
  }
  if (typeof body.unitSystem !== 'string' || !UNIT_SYSTEM_VALUES.includes(body.unitSystem as UnitSystem)) {
    throw createError({ statusCode: 400, statusMessage: 'unitSystem must be one of: ' + UNIT_SYSTEM_VALUES.join(', ') })
  }

  const db = useDb()
  const service = new ProfileService(ctx, new ProfileRepository(db), new BodyMetricsRepository(db), new UserRepository(db), new TargetRepository(db), new UserLimitationRepository(db))
  const profile = await service.updatePreferences({
    equipment: body.equipment as Equipment,
    primaryGoal: body.primaryGoal as Goal,
    experienceLevel: body.experienceLevel as ExperienceLevel,
    unitSystem: body.unitSystem as UnitSystem,
  })
  return { profile }
})
