import { BaseService } from '~~/server/services/base.service'
import type { ExerciseRepository } from '~~/server/repositories/exercise.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'

export class ExerciseService extends BaseService {
  constructor(ctx: RequestContext, private exercises: ExerciseRepository) {
    super(ctx)
  }

  getById(id: string) {
    return this.exercises.findById(id)
  }

  findByMuscle(muscleId: number) {
    return this.exercises.findByMuscle(muscleId)
  }
}
