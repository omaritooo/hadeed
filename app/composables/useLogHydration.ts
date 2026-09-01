import type { FetchError } from 'ofetch'
import type { HydrationLog } from '~~/shared/types/hydration.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useLogHydration = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<HydrationLog, number, FetchError<{ statusMessage: string }>>({
    mutation: amountMl => $api<HydrationLog>('/api/hydration', {
      method: 'POST',
      body: { amountMl },
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: ['hydration'] }),
  })
}
