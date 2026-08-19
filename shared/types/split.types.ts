export type DayLocation = 'gym' | 'home'
export type SetType = 'weight_reps' | 'bodyweight_reps' | 'time'

export interface Program {
  id: number
  userId: string
  name: string
}

export interface MacroTarget {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface Block {
  id: number
  programId: number
  userId: string
  name: string
  startDate: string
  endDate: string | null
  trainingDayMacroTarget: MacroTarget | null
  restDayMacroTarget: MacroTarget | null
}

export interface SplitDay {
  id: number
  blockId: number
  name: string
  dayOfWeek: number
  location: DayLocation
}

export interface SplitExercise {
  id: number
  splitDayId: number
  exerciseId: string
  position: number
  setType: SetType
  targetSets: number | null
  targetReps: number | null
  targetRpe: number | null
}
