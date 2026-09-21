export type XpSourceType = 'set_logged' | 'session_completed' | 'pr'

export interface XpEvent {
  id: number
  userId: string
  amount: number
  sourceType: XpSourceType
  sourceId: string
  createdAt: string
}

// The derived week streak every caller reads. Re-exported here so gamification consumers keep
// importing their types from one place.
export type { WeekStreak } from '~~/shared/lib/streak'

// The stored per-user counter behind StreakRepository. Superseded by WeekStreak and read by
// nothing but that repository, which goes away with it.
export interface Streak {
  userId: string
  currentStreak: number
  longestStreak: number
  lastActiveDate: string | null
}

export type AchievementCriteriaType = 'session_count' | 'streak_length' | 'pr_count' | 'total_volume_kg' | 'target_hit'

export interface Achievement {
  id: number
  key: string
  name: string
  description: string | null
  icon: string | null
  criteriaType: AchievementCriteriaType
  criteriaValue: Record<string, unknown>
  isPublished: boolean
}

export interface UserAchievement {
  userId: string
  achievementId: number
  unlockedAt: string
}

export interface AchievementProgress {
  current: number
  target: number
  unit: string
}

export interface AchievementWithProgress {
  key: string
  name: string
  description: string | null
  icon: string | null
  criteriaType: AchievementCriteriaType
  unlocked: boolean
  progress: AchievementProgress | null
}
