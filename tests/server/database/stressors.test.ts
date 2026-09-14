import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { Client } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { stressorRewriteStatements, validateStressorOverrides, type StressorOverrides } from '~~/server/database/stressors'
import type { JointArea } from '~~/shared/lib/joint-areas'

const __dirname = dirname(fileURLToPath(import.meta.url))

const stressorRows = async (db: Client) =>
  (await db.execute('SELECT exercise_id, area, source FROM exercise_stressors ORDER BY exercise_id, area')).rows
    .map(r => `${r.exercise_id}:${r.area}:${r.source}`)

const runRewrite = async (
  db: Client,
  ruleStressors: Record<string, JointArea[]>,
  overrides: StressorOverrides,
  knownExerciseIds = new Set(['ohp', 'landmine', 'row']),
) => {
  await db.batch(stressorRewriteStatements({
    ruleStressors: new Map(Object.entries(ruleStressors)),
    overrides,
    knownExerciseIds,
  }), 'write')
}

describe('stressorRewriteStatements', () => {
  let db: Client

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('ohp', 'Overhead Press', '[]'), ('landmine', 'Landmine Press', '[]'), ('row', 'Seal Row', '[]')`)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes rule rows, then applies add and remove overrides', async () => {
    await db.execute(`INSERT INTO exercise_stressors (exercise_id, area, source) VALUES ('ohp', 'knee', 'rule'), ('landmine', 'wrist', 'manual')`)

    await runRewrite(
      db,
      { ohp: ['shoulder'], landmine: ['shoulder', 'wrist'] },
      { landmine: { remove: ['shoulder'] }, ohp: { add: ['elbow'] } },
    )

    expect(await stressorRows(db)).toEqual([
      'landmine:wrist:rule',
      'ohp:elbow:manual',
      'ohp:shoulder:rule',
    ])
  })

  it('keeps a removed rule area removed across repeated runs', async () => {
    const overrides: StressorOverrides = { row: { remove: ['lower_back'] } }
    await runRewrite(db, { row: ['lower_back'] }, overrides)
    expect(await stressorRows(db)).toEqual([])

    await runRewrite(db, { row: ['lower_back'] }, overrides)
    expect(await stressorRows(db)).toEqual([])
  })

  it('drops a manual row once its add entry leaves the overrides file', async () => {
    await runRewrite(db, {}, { row: { add: ['ankle'] } })
    expect(await stressorRows(db)).toEqual(['row:ankle:manual'])

    await runRewrite(db, {}, {})
    expect(await stressorRows(db)).toEqual([])
  })

  it('pins a rule-produced area as manual, and returns it to rule when the add is dropped', async () => {
    await runRewrite(db, { ohp: ['shoulder'] }, { ohp: { add: ['shoulder'] } })
    expect(await stressorRows(db)).toEqual(['ohp:shoulder:manual'])

    await runRewrite(db, { ohp: ['shoulder'] }, {})
    expect(await stressorRows(db)).toEqual(['ohp:shoulder:rule'])
  })

  it('skips overrides for unknown exercise ids with a warning, and still applies the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runRewrite(db, { ohp: ['shoulder'] }, {
      Not_A_Real_Exercise: { add: ['knee'], remove: ['ankle'] },
      ohp: { add: ['elbow'] },
    })

    expect(await stressorRows(db)).toEqual(['ohp:elbow:manual', 'ohp:shoulder:rule'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('Not_A_Real_Exercise')
  })
})

describe('validateStressorOverrides', () => {
  it('throws when the overrides key is missing or not an object', () => {
    expect(() => validateStressorOverrides({})).toThrow(/overrides/)
    expect(() => validateStressorOverrides({ overrides: [] })).toThrow(/overrides/)
    expect(() => validateStressorOverrides(null)).toThrow(/overrides/)
  })

  it('throws on an area that is not a joint area', () => {
    expect(() => validateStressorOverrides({ overrides: { ohp: { add: ['hip'] } } })).toThrow(/ohp.*hip/)
  })

  it('throws when an area is both added and removed for the same exercise', () => {
    expect(() => validateStressorOverrides({ overrides: { ohp: { add: ['knee'], remove: ['knee'] } } })).toThrow(/ohp.*knee/)
  })

  it('returns the overrides for a valid file', () => {
    expect(validateStressorOverrides({ _comment: 'x', overrides: { ohp: { add: ['knee'], remove: ['elbow'] } } }))
      .toEqual({ ohp: { add: ['knee'], remove: ['elbow'] } })
  })

  it('accepts the shipped overrides file', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, '../../../exercise_stressor_overrides.json'), 'utf-8'))
    expect(Object.keys(validateStressorOverrides(raw)).length).toBeGreaterThan(0)
  })
})
