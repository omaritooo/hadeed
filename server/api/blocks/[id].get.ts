import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { SplitService } from '~~/server/services/split.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get a training block with its days and exercises',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
    ],
    responses: {
      200: { description: 'The block with its days/exercises' },
      403: { description: 'Not the owner of this block' },
      404: { description: 'Block not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const id = Number(getRouterParam(event, 'id'))
  const service = new SplitService(ctx, new BlockRepository(useDb()))

  const block = await service.getOwnedBlock(id)
  if (!block) {
    throw createError({ statusCode: 404, statusMessage: 'Block not found' })
  }
  return block
})
