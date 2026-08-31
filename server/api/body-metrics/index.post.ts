import { readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'
import { BodyMetricsService } from '~~/server/services/body-metrics.service'

defineRouteMeta({
  openAPI: {
    summary: 'Record a body metrics entry',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['recordedAt', 'weightKg', 'source', 'measurements'],
            properties: {
              recordedAt: { type: 'string', format: 'date-time' },
              weightKg: { type: 'number' },
              bodyFatPct: { type: 'number', nullable: true },
              visceralFat: { type: 'number', nullable: true },
              muscleMassKg: { type: 'number', nullable: true },
              source: { type: 'string', enum: ['manual', 'inbody', 'wearable'] },
              measurements: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['key', 'valueCm'],
                  properties: {
                    key: { type: 'string' },
                    valueCm: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'The recorded body metric' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const ctx = await getRequestContext(event)
  const body = await readBody(event)
  const service = new BodyMetricsService(ctx, new BodyMetricsRepository(useDb()))
  return service.record(body)
})
