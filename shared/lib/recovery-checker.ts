export interface RecoveryCheckDay {
  isRestDay: boolean
  exercises: { tier: number | null, primaryMuscle: string | null }[]
}

export interface RecoveryConflict {
  muscle: string
  dayIndexes: [number, number]
}

export const checkRecoveryConflicts = (days: RecoveryCheckDay[]): RecoveryConflict[] => {
  const conflicts: RecoveryConflict[] = []
  const trainingDays = days.map((day, index) => ({ day, index })).filter(({ day }) => !day.isRestDay)

  for (let i = 0; i < trainingDays.length - 1; i++) {
    const a = trainingDays[i]!
    const b = trainingDays[i + 1]!
    if (b.index !== a.index + 1) continue // a rest day sits between them in the original array

    const aTier1Muscles = new Set(a.day.exercises.filter(e => e.tier === 1 && e.primaryMuscle).map(e => e.primaryMuscle!))
    const flaggedMuscles = new Set<string>()
    for (const exercise of b.day.exercises) {
      if (exercise.tier === 1 && exercise.primaryMuscle && aTier1Muscles.has(exercise.primaryMuscle) && !flaggedMuscles.has(exercise.primaryMuscle)) {
        flaggedMuscles.add(exercise.primaryMuscle)
        conflicts.push({ muscle: exercise.primaryMuscle, dayIndexes: [a.index, b.index] })
      }
    }
  }

  return conflicts
}
