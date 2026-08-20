export type MuscleRole = 'primary' | 'secondary'

export interface Muscle {
  id: number
  name: string
}

export interface Exercise {
  id: string
  name: string
  category: string | null
  equipment: string | null
  force: string | null
  level: string | null
  mechanic: string | null
  instructions: string[]
  primaryMuscles: string[]
  secondaryMuscles: string[]
  images: string[]
}

export interface ExerciseMuscle {
  exerciseId: string
  muscleId: number
  role: MuscleRole
}
