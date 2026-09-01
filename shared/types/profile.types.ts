import type { ActivityLevel, Gender } from '~~/shared/lib/formulas'
import type { Equipment } from '~~/shared/types/preset.types'

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'
export type Goal = 'fat_loss' | 'muscle_gain' | 'maintenance' | 'general_fitness'
export type MetricSource = 'manual' | 'inbody' | 'wearable'
export type UnitSystem = 'metric' | 'imperial'

export interface UserProfile {
  userId: string
  dateOfBirth: string
  gender: Gender
  heightCm: number
  activityLevel: ActivityLevel | null
  experienceLevel: ExperienceLevel | null
  primaryGoal: Goal | null
  trainingDaysPerWeek: number | null
  equipment: Equipment | null
  unitSystem: UnitSystem
  timezone: string | null
  hydrationTargetMl: number | null
  hydrationRemindersEnabled: boolean
  hydrationReminderIntervalMinutes: number
  hydrationLastRemindedAt: string | null
  updatedAt: string
  displayName: string | null
}

export interface BodyMetric {
  id: number
  userId: string
  recordedAt: string
  weightKg: number
  bodyFatPct: number | null
  visceralFat: number | null
  muscleMassKg: number | null
  source: MetricSource
  measurements: BodyMetricMeasurement[]
}

export interface BodyMetricMeasurement {
  id: number
  bodyMetricId: number
  key: string
  valueCm: number
}

export type TargetMetric = 'weight' | 'body_fat_pct' | `measurement:${string}`

export interface UserTarget {
  id: number
  userId: string
  metric: TargetMetric
  targetValue: number
  targetDate: string | null
  startingValue: number
  startingRecordedAt: string
  achievedAt: string | null
  isActive: boolean
}
