export type XpSourceType = 'set_logged' | 'session_completed' | 'pr'

export interface XpEvent {
  id: number
  userId: string
  amount: number
  sourceType: XpSourceType
  sourceId: string
  createdAt: string
}

export interface Streak {
  userId: string
  currentStreak: number
  longestStreak: number
  lastActiveDate: string | null
}

export type AchievementCriteriaType = 'session_count' | 'streak_length' | 'pr' | 'target_hit'

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
