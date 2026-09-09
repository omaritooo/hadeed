import type { ExperienceLevel, Goal } from '~~/shared/types/profile.types'
import type { DayLocation, SplitFormat } from '~~/shared/types/split.types'

export type Equipment = 'full_gym' | 'home_barbell_dumbbell' | 'home_dumbbell_only' | 'bodyweight' | 'both'

export interface PresetSplit {
  id: number
  name: string
  description: string | null
  frequencyMinDays: number
  frequencyMaxDays: number
  goal: Goal | null
  experienceLevel: ExperienceLevel | null
  equipment: Equipment
  isPublished: boolean
}

export interface PresetSplitDay {
  id: number
  presetSplitId: number
  name: string
  dayIndex: number
  location: DayLocation
  targetMuscleIds: number[]
  format: SplitFormat
  rounds: number
}

export interface PresetSplitExercise {
  id: number
  presetSplitDayId: number
  exerciseId: string
  position: number
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
  restSeconds: number | null
}

export interface PresetExerciseOverride {
  dayIndex: number
  position: number
  exerciseId: string
}

export interface SplitRecommendation {
  preset: PresetSplit
  score: number
  reasons: string[]
}

export interface RecommendationInput {
  daysPerWeek: number
  experienceLevel: ExperienceLevel | null
  goal: Goal | null
  equipment: Equipment | null
}
