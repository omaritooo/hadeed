import type { JointArea } from '~~/shared/lib/joint-areas'
import type { RecommendationInput } from '~~/shared/types/preset.types'

export const queryKeys = {
  profile: () => ['profile'] as const,
  home: () => ['home'] as const,
  hydration: () => ['hydration'] as const,
  exercise: (id: string) => ['exercise', id] as const,
  exerciseHistory: (id: string) => ['exercise-history', id] as const,
  exerciseSearch: (query: string) => ['exercise-search', query] as const,
  exercisesByIds: (ids: string[]) => ['exercises-by-ids', ids] as const,
  exerciseFallbacks: (id: string, equipmentTiers: string[], avoid: JointArea[] = []) => ['exercise-fallbacks', id, equipmentTiers, avoid] as const,
  exerciseAlternatives: (id: string, equipmentTiers: string[], avoid: JointArea[] = []) => ['exercise-alternatives', id, equipmentTiers, avoid] as const,
  presetSplits: () => ['preset-splits'] as const,
  presetSplitsRecommend: (input: RecommendationInput) => ['preset-splits', 'recommend', input] as const,
  presetSplitDetails: (id: number) => ['preset-splits', id] as const,
  block: (id: number) => ['block', id] as const,
  // `date` (YYYY-MM-DD) is appended only when given, so the no-arg call every existing
  // mutation already uses (queryKeys.nutrition()) still resolves to the bare ['nutrition']
  // prefix -- invalidateQueries' default prefix match then still reaches whichever day's
  // query is currently cached (today's default key included), with no changes needed there.
  nutrition: (date?: string) => (date ? ['nutrition', date] as const : ['nutrition'] as const),
  tdeeEstimate: () => ['tdee-estimate'] as const,
  ingredients: () => ['ingredients'] as const,
  presetMeals: () => ['preset-meals'] as const,
  workouts: () => ['workouts'] as const,
  weeklyVolume: () => ['weekly-volume'] as const,
  achievements: () => ['achievements'] as const,
  session: (id: string) => ['session', id] as const,
  bodyMetrics: () => ['body-metrics'] as const,
  volumeHistory: (weeks: number | undefined) => ['volume-history', weeks ?? null] as const,
  prHistory: (limit: number | undefined) => ['pr-history', limit ?? null] as const,
}
