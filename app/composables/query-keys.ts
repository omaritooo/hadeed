import type { RecommendationInput } from '~~/shared/types/preset.types'

export const queryKeys = {
  profile: () => ['profile'] as const,
  home: () => ['home'] as const,
  hydration: () => ['hydration'] as const,
  exercise: (id: string) => ['exercise', id] as const,
  exerciseHistory: (id: string) => ['exercise-history', id] as const,
  presetSplits: () => ['preset-splits'] as const,
  presetSplitsRecommend: (input: RecommendationInput) => ['preset-splits', 'recommend', input] as const,
  nutrition: () => ['nutrition'] as const,
  ingredients: () => ['ingredients'] as const,
  presetMeals: () => ['preset-meals'] as const,
  workouts: () => ['workouts'] as const,
  session: (id: string) => ['session', id] as const,
}
