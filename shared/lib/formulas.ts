export type Gender = 'male' | 'female' | 'other'
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

export function bmi(input: { weightKg: number, heightCm: number }): number {
  const heightM = input.heightCm / 100
  return input.weightKg / (heightM * heightM)
}

export function cmToIn(cm: number): number {
  return cm / 2.54
}

export function inToCm(inches: number): number {
  return inches * 2.54
}

export function kgToLbs(kg: number): number {
  return kg * 2.20462262185
}

export function lbsToKg(lbs: number): number {
  return lbs / 2.20462262185
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function bmrFor(gender: Gender, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  if (gender === 'male') return base + 5
  if (gender === 'female') return base - 161
  return base + (5 + -161) / 2
}

export function tdee(input: {
  weightKg: number
  heightCm: number
  age: number
  gender: Gender
  activityLevel: ActivityLevel
}): number {
  const bmr = bmrFor(input.gender, input.weightKg, input.heightCm, input.age)
  return bmr * ACTIVITY_MULTIPLIERS[input.activityLevel]
}

const XP_PER_LEVEL_BASE = 500

export function xpToLevel(xp: number): number {
  const clamped = Math.max(0, xp)
  return Math.floor(Math.sqrt(clamped / XP_PER_LEVEL_BASE)) + 1
}
