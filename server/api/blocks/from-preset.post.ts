import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import { SplitService } from '~~/server/services/split.service'

defineRouteMeta({
  openAPI: {
    summary: 'Create a training block from a preset split',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['presetSplitId', 'name', 'startDate'],
            properties: {
              presetSplitId: { type: 'number' },
              name: { type: 'string' },
              startDate: { type: 'string', format: 'date' },
              endDate: { type: 'string', format: 'date', nullable: true },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The created block' },
      404: { description: 'Preset not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event) as { presetSplitId: number, name: string, startDate: string, endDate: string | null }
  const db = useDb()

  const preset = await new PresetSplitRepository(db).findWithDays(body.presetSplitId)
  if (!preset) {
    throw createError({ statusCode: 404, statusMessage: 'Preset not found' })
  }

  const service = new SplitService(ctx, new BlockRepository(db))
  return service.createFromPreset(preset, { name: body.name, startDate: body.startDate, endDate: body.endDate })
})
