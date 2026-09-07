import { describe, expect, it } from 'vitest'
import { classifyMovementPattern, classifyTierDeterministic } from '~~/server/utils/exercise-classification'

describe('classifyMovementPattern', () => {
  it('classifies overhead/incline pressing as vertical push', () => {
    expect(classifyMovementPattern({ name: 'Overhead Press', force: 'push', mechanic: 'compound', primaryMuscles: ['shoulders'] })).toBe('vertical_push')
    expect(classifyMovementPattern({ name: 'Incline Barbell Bench Press', force: 'push', mechanic: 'compound', primaryMuscles: ['chest'] })).toBe('vertical_push')
  })

  it('classifies flat bench/chest press as horizontal push', () => {
    expect(classifyMovementPattern({ name: 'Barbell Bench Press', force: 'push', mechanic: 'compound', primaryMuscles: ['chest'] })).toBe('horizontal_push')
  })

  it('classifies rows as horizontal pull', () => {
    expect(classifyMovementPattern({ name: 'Bent Over Barbell Row', force: 'pull', mechanic: 'compound', primaryMuscles: ['middle back'] })).toBe('horizontal_pull')
  })

  it('classifies pulldowns/pull-ups as vertical pull', () => {
    expect(classifyMovementPattern({ name: 'Wide-Grip Lat Pulldown', force: 'pull', mechanic: 'compound', primaryMuscles: ['lats'] })).toBe('vertical_pull')
    expect(classifyMovementPattern({ name: 'Pullups', force: 'pull', mechanic: 'compound', primaryMuscles: ['lats'] })).toBe('vertical_pull')
  })

  it('classifies squats/leg presses/lunges as knee-dominant', () => {
    expect(classifyMovementPattern({ name: 'Barbell Squat', force: 'push', mechanic: 'compound', primaryMuscles: ['quadriceps'] })).toBe('knee_dominant')
    expect(classifyMovementPattern({ name: 'Leg Press', force: 'push', mechanic: 'compound', primaryMuscles: ['quadriceps'] })).toBe('knee_dominant')
    expect(classifyMovementPattern({ name: 'Dumbbell Lunges', force: 'push', mechanic: 'compound', primaryMuscles: ['quadriceps'] })).toBe('knee_dominant')
  })

  it('classifies deadlifts/RDLs/hip thrusts as hip-dominant', () => {
    expect(classifyMovementPattern({ name: 'Romanian Deadlift', force: 'pull', mechanic: 'compound', primaryMuscles: ['hamstrings'] })).toBe('hip_dominant')
    expect(classifyMovementPattern({ name: 'Barbell Hip Thrust', force: 'pull', mechanic: 'compound', primaryMuscles: ['glutes'] })).toBe('hip_dominant')
  })

  it('classifies curls as elbow flexion', () => {
    expect(classifyMovementPattern({ name: 'Dumbbell Bicep Curl', force: 'pull', mechanic: 'isolation', primaryMuscles: ['biceps'] })).toBe('elbow_flexion')
  })

  it('classifies pushdowns/extensions/dips as elbow extension', () => {
    expect(classifyMovementPattern({ name: 'Triceps Pushdown', force: 'push', mechanic: 'isolation', primaryMuscles: ['triceps'] })).toBe('elbow_extension')
    expect(classifyMovementPattern({ name: 'Overhead Triceps Extension', force: 'push', mechanic: 'isolation', primaryMuscles: ['triceps'] })).toBe('elbow_extension')
  })

  it('classifies ab/core-primary exercises as core', () => {
    expect(classifyMovementPattern({ name: 'Hanging Leg Raise', force: 'pull', mechanic: 'isolation', primaryMuscles: ['abdominals'] })).toBe('core')
  })

  it('falls back to lateral_isolation for lateral raises and unmatched isolation work', () => {
    expect(classifyMovementPattern({ name: 'Side Lateral Raise', force: 'push', mechanic: 'isolation', primaryMuscles: ['shoulders'] })).toBe('lateral_isolation')
  })

  it('returns null when there is not enough signal to classify confidently', () => {
    expect(classifyMovementPattern({ name: 'Foam Roll', force: null, mechanic: null, primaryMuscles: [] })).toBeNull()
  })

  it('disambiguates "dip" by chest vs triceps in the name', () => {
    expect(classifyMovementPattern({ name: 'Dips - Chest Version', force: 'push', mechanic: 'compound', primaryMuscles: ['chest'] })).toBe('horizontal_push')
    expect(classifyMovementPattern({ name: 'Dips - Triceps Version', force: 'push', mechanic: 'compound', primaryMuscles: ['triceps'] })).toBe('elbow_extension')
  })

  it('reaches the push+shoulders fallback when no name keyword matches', () => {
    expect(classifyMovementPattern({ name: 'Mystery Shoulder Movement', force: 'push', mechanic: 'isolation', primaryMuscles: ['shoulders'] })).toBe('lateral_isolation')
  })

  it('does not treat a keyword as matched when it is embedded inside a longer word', () => {
    // 'row' inside 'Prowler' must not trigger horizontal_pull; falls back to hamstrings -> hip_dominant.
    expect(classifyMovementPattern({ name: 'Prowler Sprint', force: 'push', mechanic: 'compound', primaryMuscles: ['hamstrings'] })).toBe('hip_dominant')

    // 'fly' inside 'Butterfly' must not trigger horizontal_push; no other signal -> null.
    expect(classifyMovementPattern({ name: 'Butterfly', force: 'pull', mechanic: 'isolation', primaryMuscles: ['chest'] })).toBeNull()

    // 'row' inside 'Throw' must not trigger horizontal_pull; falls back to shoulders+push -> lateral_isolation.
    expect(classifyMovementPattern({ name: 'Backward Medicine Ball Throw', force: 'push', mechanic: 'compound', primaryMuscles: ['shoulders'] })).toBe('lateral_isolation')

    // 'rdl' inside 'hurdle' must not trigger hip_dominant; falls back to quadriceps -> knee_dominant.
    expect(classifyMovementPattern({ name: 'Front Cone Hops (or hurdle hops)', force: 'push', mechanic: 'compound', primaryMuscles: ['quadriceps'] })).toBe('knee_dominant')
  })

  it('still matches plural/suffixed forms of keywords that only satisfy a leading boundary', () => {
    expect(classifyMovementPattern({ name: 'Barbell Curls', force: 'pull', mechanic: 'isolation', primaryMuscles: ['biceps'] })).toBe('elbow_flexion')
    expect(classifyMovementPattern({ name: 'Barbell Squats', force: 'push', mechanic: 'compound', primaryMuscles: ['quadriceps'] })).toBe('knee_dominant')
    expect(classifyMovementPattern({ name: 'Barbell Rows', force: 'pull', mechanic: 'compound', primaryMuscles: ['middle back'] })).toBe('horizontal_pull')
    expect(classifyMovementPattern({ name: 'Dumbbell Flyes', force: 'push', mechanic: 'isolation', primaryMuscles: ['chest'] })).toBe('horizontal_push')
    expect(classifyMovementPattern({ name: 'Pushups', force: 'push', mechanic: 'compound', primaryMuscles: ['chest'] })).toBe('horizontal_push')
    expect(classifyMovementPattern({ name: 'Pullups', force: 'pull', mechanic: 'compound', primaryMuscles: ['lats'] })).toBe('vertical_pull')
  })
})

describe('classifyTierDeterministic', () => {
  it('classifies isolation exercises as Tier 3 regardless of equipment', () => {
    expect(classifyTierDeterministic({ mechanic: 'isolation', equipment: 'cable' })).toBe(3)
    expect(classifyTierDeterministic({ mechanic: 'isolation', equipment: 'barbell' })).toBe(3)
  })

  it('classifies compound barbell/bodyweight exercises as Tier 1', () => {
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'barbell' })).toBe(1)
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'body only' })).toBe(1)
  })

  it('classifies compound machine/cable/smith exercises as Tier 2', () => {
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'machine' })).toBe(2)
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'cable' })).toBe(2)
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'smith machine' })).toBe(2)
  })

  it('returns null for compound dumbbell exercises (ambiguous, needs LLM pass)', () => {
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'dumbbell' })).toBeNull()
  })

  it('defaults to Tier 2 when mechanic is unknown', () => {
    expect(classifyTierDeterministic({ mechanic: null, equipment: 'kettlebells' })).toBe(2)
  })

  it('defaults to Tier 2 for compound exercises with unrecognized or missing equipment (real dataset has 77 rows with null equipment)', () => {
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: null })).toBe(2)
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'kettlebells' })).toBe(2)
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'bands' })).toBe(2)
    expect(classifyTierDeterministic({ mechanic: 'compound', equipment: 'other' })).toBe(2)
  })
})
