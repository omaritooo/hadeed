import { BaseService } from '~~/server/services/base.service'
import type { MuscleRepository } from '~~/server/repositories/muscle.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'

export class MuscleService extends BaseService {
  constructor(ctx: RequestContext, private muscles: MuscleRepository) {
    super(ctx)
  }

  list() {
    return this.muscles.findMany()
  }
}
