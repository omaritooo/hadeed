import type { Client } from '@libsql/client'
import type { JointArea } from '~~/shared/lib/joint-areas'

export type StressorOverrides = Record<string, { add?: JointArea[], remove?: JointArea[] }>

// Rewrites the rule-derived rows for one exercise. A manual row for the same area wins the
// conflict and is left as manual.
export const writeRuleStressors = async (db: Client, exerciseId: string, areas: JointArea[]): Promise<void> => {
  await db.execute({ sql: `DELETE FROM exercise_stressors WHERE exercise_id = ? AND source = 'rule'`, args: [exerciseId] })
  for (const area of areas) {
    await db.execute({
      sql: `INSERT INTO exercise_stressors (exercise_id, area, source) VALUES (?, ?, 'rule') ON CONFLICT (exercise_id, area) DO NOTHING`,
      args: [exerciseId, area],
    })
  }
}

// `add` pins an area as manual (surviving future rule runs); `remove` deletes a wrong rule row.
// A removed area comes back on the next classify run unless it stays listed here, which is
// the point: the overrides file is the permanent record of corrections.
//
// Ids missing from `exercises` are skipped with a warning: foreign keys are enforced, so an
// `add` for them would throw and abort the whole classify run over one stale or mistyped key.
export const applyStressorOverrides = async (db: Client, overrides: StressorOverrides): Promise<void> => {
  const ids = Object.keys(overrides)
  if (ids.length === 0) return
  const known = await db.execute({
    sql: `SELECT id FROM exercises WHERE id IN (${ids.map(() => '?').join(', ')})`,
    args: ids,
  })
  const knownIds = new Set(known.rows.map(r => r.id as string))

  for (const [exerciseId, { add = [], remove = [] }] of Object.entries(overrides)) {
    if (!knownIds.has(exerciseId)) {
      console.warn(`exercise_stressor_overrides.json: no exercise with id "${exerciseId}", skipping its override.`)
      continue
    }
    for (const area of remove) {
      await db.execute({ sql: `DELETE FROM exercise_stressors WHERE exercise_id = ? AND area = ? AND source = 'rule'`, args: [exerciseId, area] })
    }
    for (const area of add) {
      await db.execute({
        sql: `INSERT INTO exercise_stressors (exercise_id, area, source) VALUES (?, ?, 'manual')
              ON CONFLICT (exercise_id, area) DO UPDATE SET source = 'manual'`,
        args: [exerciseId, area],
      })
    }
  }
}
