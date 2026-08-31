import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { ExerciseService } from '~~/server/services/exercise.service'

defineRouteMeta({
  openAPI: {
    summary: 'Get exercise by id',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: { description: 'The exercise' },
      404: { description: 'Exercise not found' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const id = getRouterParam(event, 'id')!
  const service = new ExerciseService(ctx, new ExerciseRepository(useDb()))

  const exercise = await service.getById(id)
  if (!exercise) {
    throw createError({ statusCode: 404, statusMessage: 'Exercise not found' })
  }
  console.log(exercise)
  return exercise
})
