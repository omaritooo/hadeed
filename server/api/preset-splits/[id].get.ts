import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import { PresetSplitService } from '~~/server/services/preset-split.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get a preset split with its days and exercises',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ],
    responses: {
      200: { description: 'The preset split with days and exercises' },
      404: { description: 'Preset not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const id = Number(getRouterParam(event, 'id'))
  const service = new PresetSplitService(ctx, new PresetSplitRepository(useDb()))

  const preset = await service.getWithDays(id)
  if (!preset) {
    throw createError({ statusCode: 404, statusMessage: 'Preset not found' })
  }
  return preset
})
