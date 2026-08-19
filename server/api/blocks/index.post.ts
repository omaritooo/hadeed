import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { BlockRepository } from '~~/server/repositories/block.repository'
import { SplitService } from '~~/server/services/split.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const service = new SplitService(ctx, new BlockRepository(useDb()))
  return service.createFromScratch(body)
})
