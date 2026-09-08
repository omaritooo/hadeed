import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { Exercise } from '~~/shared/types/exercise.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

// Fetches equipment-compatible substitutes for a source exercise. Disabled until both
// an exerciseId is set and at least one acceptable equipment value is known — see
// equipmentValuesForTier in shared/lib/equipment.ts for how callers build that list
// from a user's Equipment tier.
export const useExerciseFallbacks = (
  exerciseId: MaybeRefOrGetter<string | null>,
  equipmentTiers: MaybeRefOrGetter<string[]>,
) => {
  const { $api } = useNuxtApp()

  return useQuery<Exercise[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.exerciseFallbacks(toValue(exerciseId) ?? '', toValue(equipmentTiers)),
    query: () => $api<Exercise[]>(`/api/exercises/${toValue(exerciseId)}/fallbacks`, {
      query: { equipmentTiers: toValue(equipmentTiers).join(',') },
    }),
    enabled: () => !!toValue(exerciseId) && toValue(equipmentTiers).length > 0,
  })
}
