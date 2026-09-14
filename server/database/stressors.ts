import type { InStatement } from '@libsql/client'
import { isJointArea, type JointArea } from '~~/shared/lib/joint-areas'

export type StressorOverrides = Record<string, { add?: JointArea[], remove?: JointArea[] }>

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validateAreas = (exerciseId: string, key: 'add' | 'remove', value: unknown): JointArea[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`exercise_stressor_overrides.json: "${exerciseId}".${key} must be an array of joint areas.`)
  }
  for (const area of value) {
    if (!isJointArea(area)) {
      throw new Error(`exercise_stressor_overrides.json: "${exerciseId}".${key} has unknown joint area ${JSON.stringify(area)}.`)
    }
  }
  return value as JointArea[]
}

// Checks the parsed overrides file before any DB work, so a typo fails the run instead of
// silently writing (or dropping) tags.
export const validateStressorOverrides = (raw: unknown): StressorOverrides => {
  if (!isPlainObject(raw) || !isPlainObject(raw.overrides)) {
    throw new Error('exercise_stressor_overrides.json: expected an "overrides" object keyed by exercise id.')
  }
  const result: StressorOverrides = {}
  for (const [exerciseId, entry] of Object.entries(raw.overrides)) {
    if (!isPlainObject(entry)) {
      throw new Error(`exercise_stressor_overrides.json: "${exerciseId}" must be an object with "add" and/or "remove".`)
    }
    const add = validateAreas(exerciseId, 'add', entry.add)
    const remove = validateAreas(exerciseId, 'remove', entry.remove)
    const overlap = (add ?? []).filter(area => remove?.includes(area))
    if (overlap.length > 0) {
      throw new Error(`exercise_stressor_overrides.json: "${exerciseId}" both adds and removes ${overlap.join(', ')}.`)
    }
    result[exerciseId] = { ...(add && { add }), ...(remove && { remove }) }
  }
  return result
}

// Statements that rebuild exercise_stressors from scratch: rule rows, then the overrides file on
// top. Run them with db.batch(..., 'write') so the rebuild is one transaction. Rebuilding every
// run makes the overrides file the only source of manual rows: an entry deleted from the file,
// or moved from add to remove, is reflected on the next run.
export const stressorRewriteStatements = (input: {
  ruleStressors: Map<string, JointArea[]>
  overrides: StressorOverrides
  knownExerciseIds: Set<string>
}): InStatement[] => {
  const { ruleStressors, overrides, knownExerciseIds } = input
  const statements: InStatement[] = [`DELETE FROM exercise_stressors`]

  for (const [exerciseId, areas] of ruleStressors) {
    for (const area of areas) {
      statements.push({
        sql: `INSERT INTO exercise_stressors (exercise_id, area, source) VALUES (?, ?, 'rule') ON CONFLICT (exercise_id, area) DO NOTHING`,
        args: [exerciseId, area],
      })
    }
  }

  for (const [exerciseId, { add = [], remove = [] }] of Object.entries(overrides)) {
    // Foreign keys are enforced, so an add for an unknown id would fail the whole batch.
    if (!knownExerciseIds.has(exerciseId)) {
      console.warn(`exercise_stressor_overrides.json: no exercise with id "${exerciseId}", skipping its override.`)
      continue
    }
    for (const area of remove) {
      statements.push({ sql: `DELETE FROM exercise_stressors WHERE exercise_id = ? AND area = ?`, args: [exerciseId, area] })
    }
    for (const area of add) {
      statements.push({
        sql: `INSERT INTO exercise_stressors (exercise_id, area, source) VALUES (?, ?, 'manual')
              ON CONFLICT (exercise_id, area) DO UPDATE SET source = 'manual'`,
        args: [exerciseId, area],
      })
    }
  }

  return statements
}
