import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { ExerciseHistoryEntry } from '~~/shared/types/session.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

export interface ExerciseHistoryResponse {
  personalRecord: { weightKg: number, reps: number, date: string } | null
  history: ExerciseHistoryEntry[]
}

export const useExerciseHistory = (id: MaybeRefOrGetter<string>) => {
  const { $api } = useNuxtApp()

  return useQuery<ExerciseHistoryResponse, FetchError<{ statusMessage: string }>>({
    key: () => ['exercise-history', toValue(id)],
    query: () => $api<ExerciseHistoryResponse>(`/api/exercises/${toValue(id)}/history`),
    enabled: () => toValue(id) !== '',
  })
}
