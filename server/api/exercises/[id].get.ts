import { createError, getRouterParam } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import { ExerciseService } from '~~/server/services/exercise.service'

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
