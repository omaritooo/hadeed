import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { applyStressorOverrides, writeRuleStressors, type StressorOverrides } from '~~/server/database/stressors'
import { isJointArea } from '~~/shared/lib/joint-areas'

const __dirname = dirname(fileURLToPath(import.meta.url))

const stressorRows = async (db: Awaited<ReturnType<typeof createTestDb>>) =>
  (await db.execute('SELECT exercise_id, area, source FROM exercise_stressors ORDER BY exercise_id, area')).rows
    .map(r => `${r.exercise_id}:${r.area}:${r.source}`)

describe('stressor write-through', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replaces rule rows, keeps manual rows, and applies overrides', async () => {
    const db = await createTestDb()
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('ohp', 'Overhead Press', '[]'), ('landmine', 'Landmine Press', '[]')`)
    await db.execute(`INSERT INTO exercise_stressors (exercise_id, area, source) VALUES ('ohp', 'knee', 'rule'), ('landmine', 'wrist', 'manual')`)

    await writeRuleStressors(db, 'ohp', ['shoulder'])
    await writeRuleStressors(db, 'landmine', ['shoulder'])
    await applyStressorOverrides(db, { landmine: { remove: ['shoulder'] }, ohp: { add: ['elbow'] } })

    expect(await stressorRows(db)).toEqual([
      'landmine:wrist:manual',
      'ohp:elbow:manual',
      'ohp:shoulder:rule',
    ])
  })

  it('does not let a rule write downgrade a manual row for the same area', async () => {
    const db = await createTestDb()
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('ohp', 'Overhead Press', '[]')`)
    await db.execute(`INSERT INTO exercise_stressors (exercise_id, area, source) VALUES ('ohp', 'shoulder', 'manual')`)

    await writeRuleStressors(db, 'ohp', ['shoulder', 'elbow'])

    expect(await stressorRows(db)).toEqual(['ohp:elbow:rule', 'ohp:shoulder:manual'])
  })

  it('skips overrides for exercise ids missing from the database with a warning, and still applies the rest', async () => {
    const db = await createTestDb()
    await db.execute(`INSERT INTO exercises (id, name, instructions) VALUES ('ohp', 'Overhead Press', '[]')`)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(applyStressorOverrides(db, {
      Not_A_Real_Exercise: { add: ['knee'], remove: ['ankle'] },
      ohp: { add: ['elbow'] },
    })).resolves.toBeUndefined()

    expect(await stressorRows(db)).toEqual(['ohp:elbow:manual'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('Not_A_Real_Exercise')
  })

  it('ships an overrides file whose areas are all valid joint areas', () => {
    const file = JSON.parse(readFileSync(resolve(__dirname, '../../../exercise_stressor_overrides.json'), 'utf-8')) as { overrides: StressorOverrides }
    const entries = Object.values(file.overrides)
    expect(entries.length).toBeGreaterThan(0)
    for (const { add = [], remove = [] } of entries) {
      for (const area of [...add, ...remove]) expect(isJointArea(area)).toBe(true)
    }
    expect(file.overrides.Frog_Hops).toEqual({ add: ['knee', 'ankle'] })
  })
})
