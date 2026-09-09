import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { Exercise } from '~~/shared/types/exercise.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

// Batch-resolves display names/images for a set of exercise ids in one round trip — used by the
// preset review step, which only gets bare exerciseIds from PresetSplitExercise.
export const useExercisesByIds = (ids: MaybeRefOrGetter<string[]>) => {
  const { $api } = useNuxtApp()

  return useQuery<Exercise[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.exercisesByIds(toValue(ids)),
    query: () => $api<Exercise[]>('/api/exercises/by-ids', {
      query: { ids: toValue(ids).join(',') },
    }),
    enabled: () => toValue(ids).length > 0,
  })
}
