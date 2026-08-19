import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import { PresetSplitService } from '~~/server/services/preset-split.service'

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const service = new PresetSplitService(ctx, new PresetSplitRepository(useDb()))
  return service.create(body)
})
