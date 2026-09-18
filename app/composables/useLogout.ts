import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useLogout = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ success: boolean }, void, FetchError<{ statusMessage: string }>>({
    mutation: () => $api<{ success: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),
    // Cached data belongs to the account that fetched it, so it leaves with them: signing into a
    // second account in the same tab would otherwise show the previous user's data until each
    // query refetched -- as long as staleTime, which is ten minutes for the TDEE estimate.
    // In-flight requests are cancelled first so one landing mid-clear can't repopulate the cache.
    // Runs on failure too, because the caller navigates to /login either way.
    onSettled: () => {
      queryCache.cancelQueries()
      for (const entry of queryCache.getEntries()) queryCache.remove(entry)
    },
  })
}
