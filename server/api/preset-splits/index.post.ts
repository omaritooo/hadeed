import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import { PresetSplitService } from '~~/server/services/preset-split.service'

defineRouteMeta({
  openAPI: {
    summary: 'Create a preset split',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'frequencyMinDays', 'frequencyMaxDays', 'equipment', 'isPublished', 'days'],
            properties: {
              name: { type: 'string' },
              description: { type: 'string', nullable: true },
              frequencyMinDays: { type: 'number' },
              frequencyMaxDays: { type: 'number' },
              goal: { type: 'string', nullable: true, enum: ['fat_loss', 'muscle_gain', 'maintenance', 'general_fitness'] },
              experienceLevel: { type: 'string', nullable: true, enum: ['beginner', 'intermediate', 'advanced'] },
              equipment: { type: 'string', enum: ['gym', 'home', 'both'] },
              isPublished: { type: 'boolean' },
              days: { type: 'array', items: { type: 'object', description: 'CreatePresetDayInput' } },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The created preset split' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const service = new PresetSplitService(ctx, new PresetSplitRepository(useDb()))
  return service.create(body)
})
