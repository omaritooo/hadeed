import type { Client } from '@libsql/client'
import type { BodyMetric, MetricSource } from '~~/shared/types/profile.types'

export interface RecordBodyMetricInput {
  recordedAt: string
  weightKg: number
  bodyFatPct?: number | null
  visceralFat?: number | null
  muscleMassKg?: number | null
  source: MetricSource
  measurements: { key: string, valueCm: number }[]
}

export class BodyMetricsRepository {
  constructor(private db: Client) {}

  private mapRow(row: Record<string, unknown>): Omit<BodyMetric, 'measurements'> {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      recordedAt: row.recorded_at as string,
      weightKg: row.weight_kg as number,
      bodyFatPct: row.body_fat_pct as number | null,
      visceralFat: row.visceral_fat as number | null,
      muscleMassKg: row.muscle_mass_kg as number | null,
      source: row.source as MetricSource,
    }
  }

  private async loadMeasurements(bodyMetricId: number) {
    const result = await this.db.execute({
      sql: 'SELECT * FROM body_metric_measurements WHERE body_metric_id = ?',
      args: [bodyMetricId],
    })
    return result.rows.map(row => ({
      id: row.id as number,
      bodyMetricId: row.body_metric_id as number,
      key: row.key as string,
      valueCm: row.value_cm as number,
    }))
  }

  async record(userId: string, input: RecordBodyMetricInput): Promise<BodyMetric> {
    const result = await this.db.execute({
      sql: `INSERT INTO body_metrics (user_id, recorded_at, weight_kg, body_fat_pct, visceral_fat, muscle_mass_kg, source)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        userId,
        input.recordedAt,
        input.weightKg,
        input.bodyFatPct ?? null,
        input.visceralFat ?? null,
        input.muscleMassKg ?? null,
        input.source,
      ],
    })
    const insertedRow = result.rows[0]
    if (!insertedRow) throw new Error('Failed to record body metric')
    const row = this.mapRow(insertedRow as unknown as Record<string, unknown>)

    for (const m of input.measurements) {
      await this.db.execute({
        sql: 'INSERT INTO body_metric_measurements (body_metric_id, key, value_cm) VALUES (?, ?, ?)',
        args: [row.id, m.key, m.valueCm],
      })
    }

    return { ...row, measurements: await this.loadMeasurements(row.id) }
  }

  async findForUser(userId: string): Promise<BodyMetric[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM body_metrics WHERE user_id = ? ORDER BY recorded_at DESC',
      args: [userId],
    })
    const rows = result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
    return Promise.all(rows.map(async row => ({ ...row, measurements: await this.loadMeasurements(row.id) })))
  }
}
