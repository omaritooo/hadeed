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

  it('orders findForUser by recorded_at descending', async () => {
    await repo.record('user-1', { recordedAt: '2026-08-01', weightKg: 82, source: 'manual', measurements: [] })
    await repo.record('user-1', { recordedAt: '2026-08-15', weightKg: 80, source: 'manual', measurements: [] })

    const results = await repo.findForUser('user-1')
    expect(results.map(r => r.recordedAt)).toEqual(['2026-08-15', '2026-08-01'])
  })
})
