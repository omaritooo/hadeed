export type Gender = 'male' | 'female'
export type ActivityLevel =
  | 'sedentary'
  | 'lightly_active'
  | 'moderately_active'
  | 'very_active'
  | 'extremely_active'

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extremely_active: 1.9,
}

export const bmi = (input: { weightKg: number, heightCm: number }): number => {
  const heightM = input.heightCm / 100
  return input.weightKg / (heightM * heightM)
}

export const cmToIn = (cm: number): number => {
  return cm / 2.54
}

export const inToCm = (inches: number): number => {
  return inches * 2.54
}

export const kgToLbs = (kg: number): number => {
  return kg * 2.20462262185
}

export const lbsToKg = (lbs: number): number => {
  return lbs / 2.20462262185
}

export const round1 = (n: number): number => {
  return Math.round(n * 10) / 10
}

const bmrFor = (gender: Gender, weightKg: number, heightCm: number, age: number): number => {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  if (gender === 'male') return base + 5
  if (gender === 'female') return base - 161
  return base + (5 + -161) / 2
}

export const tdee = (input: {
  weightKg: number
  heightCm: number
  age: number
  gender: Gender
  activityLevel: ActivityLevel
}): number => {
  const bmr = bmrFor(input.gender, input.weightKg, input.heightCm, input.age)
  return bmr * ACTIVITY_MULTIPLIERS[input.activityLevel]
}

const XP_PER_LEVEL_BASE = 500

export const xpToLevel = (xp: number): number => {
  const clamped = Math.max(0, xp)
  return Math.floor(Math.sqrt(clamped / XP_PER_LEVEL_BASE)) + 1
}

export const xpFloorForLevel = (level: number): number => {
  return XP_PER_LEVEL_BASE * (level - 1) ** 2
}
