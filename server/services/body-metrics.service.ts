import { BaseService } from '~~/server/services/base.service'
import type { BodyMetricsRepository, RecordBodyMetricInput } from '~~/server/repositories/body-metrics.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'

export class BodyMetricsService extends BaseService {
  constructor(ctx: RequestContext, private metrics: BodyMetricsRepository) {
    super(ctx)
  }

  record(input: RecordBodyMetricInput) {
    return this.metrics.record(this.ctx.userId, input)
  }

  list() {
    return this.metrics.findForUser(this.ctx.userId)
  }
}
