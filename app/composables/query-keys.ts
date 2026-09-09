import type { RecommendationInput } from '~~/shared/types/preset.types'

export const queryKeys = {
  profile: () => ['profile'] as const,
  home: () => ['home'] as const,
  hydration: () => ['hydration'] as const,
  exercise: (id: string) => ['exercise', id] as const,
  exerciseHistory: (id: string) => ['exercise-history', id] as const,
  exerciseSearch: (query: string) => ['exercise-search', query] as const,
  exercisesByIds: (ids: string[]) => ['exercises-by-ids', ids] as const,
  exerciseFallbacks: (id: string, equipmentTiers: string[]) => ['exercise-fallbacks', id, equipmentTiers] as const,
  exerciseAlternatives: (id: string, equipmentTiers: string[]) => ['exercise-alternatives', id, equipmentTiers] as const,
  presetSplits: () => ['preset-splits'] as const,
  presetSplitsRecommend: (input: RecommendationInput) => ['preset-splits', 'recommend', input] as const,
  presetSplitDetails: (id: number) => ['preset-splits', id] as const,
  nutrition: () => ['nutrition'] as const,
  ingredients: () => ['ingredients'] as const,
  presetMeals: () => ['preset-meals'] as const,
  workouts: () => ['workouts'] as const,
  weeklyVolume: () => ['weekly-volume'] as const,
  session: (id: string) => ['session', id] as const,
}
