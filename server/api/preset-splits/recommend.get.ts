import { createError, getQuery } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import { PresetSplitService } from '~~/server/services/preset-split.service'
import type { Equipment } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal } from '~~/shared/types/profile.types'

const EXPERIENCE_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced']
const GOALS: Goal[] = ['fat_loss', 'muscle_gain', 'maintenance', 'general_fitness']
const EQUIPMENT_OPTIONS: Equipment[] = ['gym', 'home', 'both']

// Nitro parses this call's argument statically (AST), not at runtime, so values
// must be literals here — references to EXPERIENCE_LEVELS etc. above resolve to nothing.
defineRouteMeta({
  openAPI: {
    summary: 'Recommend preset splits',
    description: 'Scores and ranks published preset splits against the given training profile.',
    parameters: [
      {
        name: 'daysPerWeek',
        in: 'query',
        required: true,
        schema: { type: 'number', minimum: 1 },
      },
      {
        name: 'experienceLevel',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      },
      {
        name: 'goal',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['fat_loss', 'muscle_gain', 'maintenance', 'general_fitness'] },
      },
      {
        name: 'equipment',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['gym', 'home', 'both'] },
      },
    ],
    responses: {
      200: {
        description: 'Ranked list of preset split recommendations',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  preset: {
                    type: 'object',
                    properties: {
                      id: { type: 'number' },
                      name: { type: 'string' },
                      description: { type: 'string', nullable: true },
                      frequencyMinDays: { type: 'number' },
                      frequencyMaxDays: { type: 'number' },
                      goal: { type: 'string', enum: ['fat_loss', 'muscle_gain', 'maintenance', 'general_fitness'], nullable: true },
                      experienceLevel: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'], nullable: true },
                      equipment: { type: 'string', enum: ['gym', 'home', 'both'] },
                      isPublished: { type: 'boolean' },
                    },
                  },
                  score: { type: 'number' },
                  reasons: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      400: {
        description: 'Invalid daysPerWeek, experienceLevel, goal, or equipment',
      },
    },
  },
})

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid ${field}` })
  }
  return value as T
}

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const query = getQuery(event)

  const daysPerWeek = Number(query.daysPerWeek)
  if (!Number.isFinite(daysPerWeek) || daysPerWeek <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'daysPerWeek must be a positive number' })
  }

  const service = new PresetSplitService(ctx, new PresetSplitRepository(useDb()))
  return service.recommend({
    daysPerWeek,
    experienceLevel: parseEnum(query.experienceLevel, EXPERIENCE_LEVELS, 'experienceLevel'),
    goal: parseEnum(query.goal, GOALS, 'goal'),
    equipment: parseEnum(query.equipment, EQUIPMENT_OPTIONS, 'equipment'),
  })
})
