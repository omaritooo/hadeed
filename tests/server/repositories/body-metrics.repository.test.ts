import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { BodyMetricsRepository } from '~~/server/repositories/body-metrics.repository'

describe('BodyMetricsRepository', () => {
  let db: Client
  let repo: BodyMetricsRepository

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    repo = new BodyMetricsRepository(db)
  })

  it('records an entry with measurements and reads it back', async () => {
    const entry = await repo.record('user-1', {
      recordedAt: '2026-08-18',
      weightKg: 80,
      source: 'manual',
      measurements: [{ key: 'waist', valueCm: 85 }, { key: 'chest', valueCm: 105 }],
    })
    expect(entry.measurements).toHaveLength(2)

    const [latest] = await repo.findForUser('user-1')
    expect(latest).toBeDefined()
    expect(latest?.weightKg).toBe(80)
    expect(latest?.measurements.map(m => m.key).sort()).toEqual(['chest', 'waist'])
  })

  it('records an entry when measurements is omitted from the input', async () => {
    // Regression: the caller-facing route declares `measurements` required, but a malformed
    // or legacy request could omit it - record() previously did `for (const m of
    // input.measurements)` with no fallback, throwing "not iterable" *after* the body_metrics
    // row had already been inserted (write succeeds, caller still gets a 500).
    const entry = await repo.record('user-1', {
      recordedAt: '2026-08-18',
      weightKg: 80,
      source: 'manual',
    } as Parameters<typeof repo.record>[1])
    expect(entry.measurements).toEqual([])

    const [latest] = await repo.findForUser('user-1')
    expect(latest?.weightKg).toBe(80)
  })

  it('orders findForUser by recorded_at descending', async () => {
    await repo.record('user-1', { recordedAt: '2026-08-01', weightKg: 82, source: 'manual', measurements: [] })
    await repo.record('user-1', { recordedAt: '2026-08-15', weightKg: 80, source: 'manual', measurements: [] })

    const results = await repo.findForUser('user-1')
    expect(results.map(r => r.recordedAt)).toEqual(['2026-08-15', '2026-08-01'])
  })

  it('returns weigh-ins in range, oldest first', async () => {
    const entries = [
      ['2026-08-10T07:00:00.000Z', 79.5],
      ['2026-07-31T07:00:00.000Z', 81],
      ['2026-08-02T07:00:00.000Z', 80],
      ['2026-08-29T07:00:00.000Z', 79], // on the exclusive end date -> excluded
    ] as const
    for (const [recordedAt, weightKg] of entries) {
      await repo.record('user-1', { recordedAt, weightKg, source: 'manual', measurements: [] })
    }

    expect(await repo.findWeightsInRange('user-1', '2026-08-01', '2026-08-29')).toEqual([
      { date: '2026-08-02T07:00:00.000Z', weightKg: 80 },
      { date: '2026-08-10T07:00:00.000Z', weightKg: 79.5 },
    ])
  })
})
