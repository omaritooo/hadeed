import { describe, expect, it } from 'vitest'
import { classifyMovementPattern } from '~~/server/utils/exercise-classification'

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
})
