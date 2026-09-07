import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { Exercise } from '~~/shared/types/exercise.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

export const useExerciseSearch = (search: MaybeRefOrGetter<string>) => {
  const { $api } = useNuxtApp()

  return useQuery<Exercise[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.exerciseSearch(toValue(search)),
    query: () => $api<Exercise[]>('/api/exercises', { query: { search: toValue(search) } }),
    enabled: () => toValue(search).trim() !== '',
  })
}
