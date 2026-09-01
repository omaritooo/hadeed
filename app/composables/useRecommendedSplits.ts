import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { RecommendationInput, SplitRecommendation } from '~~/shared/types/preset.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

export const useRecommendedSplits = (input: MaybeRefOrGetter<RecommendationInput>) => {
  const { $api } = useNuxtApp()

  return useQuery<SplitRecommendation[], FetchError<{ statusMessage: string }>>({
    key: () => ['preset-splits', 'recommend', toValue(input)],
    query: () => {
      const value = toValue(input)
      return $api<SplitRecommendation[]>('/api/preset-splits/recommend', {
        query: {
          daysPerWeek: value.daysPerWeek,
          experienceLevel: value.experienceLevel ?? undefined,
          goal: value.goal ?? undefined,
          equipment: value.equipment ?? undefined,
        },
      })
    },
  })
}
