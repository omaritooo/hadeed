import { BaseService } from '~~/server/services/base.service'
import type { CreateTargetInput, TargetRepository } from '~~/server/repositories/target.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'

export class TargetService extends BaseService {
  constructor(ctx: RequestContext, private targets: TargetRepository) {
    super(ctx)
  }

  create(input: CreateTargetInput) {
    return this.targets.create(this.ctx.userId, input)
  }

  listActive() {
    return this.targets.findActiveForUser(this.ctx.userId)
  }
}
