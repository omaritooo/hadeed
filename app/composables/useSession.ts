import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { WorkoutSessionWithLogs } from '~~/shared/types/session.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

export const useSession = (id: MaybeRefOrGetter<string>) => {
  const { $api } = useNuxtApp()

  return useQuery<WorkoutSessionWithLogs, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.session(toValue(id)),
    query: () => $api<WorkoutSessionWithLogs>(`/api/sessions/${toValue(id)}`),
    enabled: () => toValue(id) !== '',
  })
}
