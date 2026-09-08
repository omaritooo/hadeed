import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { Exercise } from '~~/shared/types/exercise.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

// Fetches swap alternatives for an exercise — same movement pattern/primary muscle,
// restricted to the given equipment values. Powers the Exercise Swap Sheet, where any
// picked exercise can be swapped for another for any reason (not only an equipment
// mismatch — that's useExerciseFallbacks' job). Disabled until both an exerciseId is set
// and at least one acceptable equipment value is known.
export const useExerciseAlternatives = (
  exerciseId: MaybeRefOrGetter<string | null>,
  equipmentTiers: MaybeRefOrGetter<string[]>,
) => {
  const { $api } = useNuxtApp()

  return useQuery<Exercise[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.exerciseAlternatives(toValue(exerciseId) ?? '', toValue(equipmentTiers)),
    query: () => $api<Exercise[]>(`/api/exercises/${toValue(exerciseId)}/alternatives`, {
      query: { equipmentTiers: toValue(equipmentTiers).join(',') },
    }),
    enabled: () => !!toValue(exerciseId) && toValue(equipmentTiers).length > 0,
  })
}
