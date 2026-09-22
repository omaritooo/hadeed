import type { FetchError } from 'ofetch'
import { useMutation, useQueryCache } from '@pinia/colada'
import { rememberUser } from '~~/app/lib/last-user'

// Filled by the service worker with one account's pages and API reads (app/sw.ts).
const PER_USER_CACHES = ['pages', 'api-reads']

export const useLogout = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()
  // The outbox plugin is client-only, as is every store cleared below; on the server there is
  // nothing queued and no browser storage to clear.
  const outbox = import.meta.client ? useOutbox() : null

  return useMutation<{ success: boolean }, void, FetchError<{ statusMessage: string }>>({
    mutation: () => $api<{ success: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),
    // Everything the app keeps for the signed-in user leaves with them, here rather than in the
    // page that calls this, so a second sign-out button can never be written without it. Signing
    // into a second account on the same phone would otherwise show the previous user's data --
    // the query cache until each query refetched (as long as staleTime, ten minutes for the TDEE
    // estimate), and the offline stores until the storage was cleared by hand, which no lifter
    // does. In-flight requests are cancelled first so one landing mid-clear can't repopulate any
    // of it -- including, through the service worker, the api-reads cache.
    // Runs on failure too, because the caller navigates to /login either way.
    onSettled: async () => {
      queryCache.cancelQueries()
      for (const entry of queryCache.getEntries()) queryCache.remove(entry)
      if (!import.meta.client) return
      // The "was signed in here" marker: left behind, it would let the next navigation made
      // offline through as the account that just left.
      rememberUser(null)
      // `typeof`, because in a non-secure context the identifier is not declared at all and
      // naming it would throw rather than read as undefined.
      const cacheClears = typeof caches === 'undefined' ? [] : PER_USER_CACHES.map(name => caches.delete(name))
      // allSettled, and awaited: one store refusing (a quota wall, private browsing) must not
      // skip the others, and the caller navigates as soon as this resolves.
      await Promise.allSettled([
        // The outbox queue plus the session snapshots the page falls back to offline.
        outbox?.reset(),
        ...cacheClears,
      ])
    },
  })
}
