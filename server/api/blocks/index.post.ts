import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { SplitService } from '~~/server/services/split.service'

defineRouteMeta({
  openAPI: {
    summary: 'Create a training block from scratch',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'startDate', 'days'],
            properties: {
              name: { type: 'string' },
              startDate: { type: 'string', format: 'date' },
              endDate: { type: 'string', format: 'date', nullable: true },
              trainingDayMacroTarget: { type: 'object', nullable: true, description: 'MacroTarget' },
              restDayMacroTarget: { type: 'object', nullable: true, description: 'MacroTarget' },
              days: { type: 'array', items: { type: 'object', description: 'CreateSplitDayInput' } },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The created block' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const service = new SplitService(ctx, new BlockRepository(useDb()))
  return service.createFromScratch(body)
})
