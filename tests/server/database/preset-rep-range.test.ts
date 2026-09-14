import { describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { presetRepRange, presetRepRangeMaxSql } from '~~/server/database/preset-rep-range'

describe('presetRepRange', () => {
  it('widens a single target by the tier thresholds', () => {
    expect(presetRepRange(null)).toEqual({ targetRepsMin: null, targetRepsMax: null })
    expect(presetRepRange(8)).toEqual({ targetRepsMin: 8, targetRepsMax: 10 })
    expect(presetRepRange(10)).toEqual({ targetRepsMin: 10, targetRepsMax: 12 })
    expect(presetRepRange(12)).toEqual({ targetRepsMin: 12, targetRepsMax: 15 })
    expect(presetRepRange(15)).toEqual({ targetRepsMin: 15, targetRepsMax: 18 })
    expect(presetRepRange(20)).toEqual({ targetRepsMin: 20, targetRepsMax: 25 })
  })

  it('agrees with the SQL CASE expression for every target from 1 to 30 and null', async () => {
    const db = createClient({ url: ':memory:' })
    await db.execute('CREATE TABLE targets (target_reps INTEGER)')
    const targets = [...Array.from({ length: 30 }, (_, i) => i + 1), null]
    await db.batch(targets.map(target => ({ sql: 'INSERT INTO targets (target_reps) VALUES (?)', args: [target] })))

    const result = await db.execute(`SELECT target_reps, ${presetRepRangeMaxSql('target_reps')} AS max FROM targets`)
    expect(result.rows).toHaveLength(targets.length)
    for (const row of result.rows) {
      const target = row.target_reps as number | null
      expect(row.max).toBe(presetRepRange(target).targetRepsMax)
    }
  })
})
