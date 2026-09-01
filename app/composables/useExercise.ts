import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { Exercise } from '~~/shared/types/exercise.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

export const useExercise = (id: MaybeRefOrGetter<string>) => {
  const { $api } = useNuxtApp()

  return useQuery<Exercise, FetchError<{ statusMessage: string }>>({
    key: () => ['exercise', toValue(id)],
    query: () => $api<Exercise>(`/api/exercises/${toValue(id)}`),
    enabled: () => toValue(id) !== '',
  })
}
