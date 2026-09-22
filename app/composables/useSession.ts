import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { SessionWithPending } from '~~/app/lib/outbox'
import type { WorkoutSessionWithLogs } from '~~/shared/types/session.types'
import { useQuery } from '@pinia/colada'
import { computed, shallowRef, toValue, watch } from 'vue'
import { applyPending } from '~~/app/lib/outbox'
import { loadSnapshot, saveSnapshot } from '~~/app/lib/outbox-store'

export const useSession = (id: MaybeRefOrGetter<string>) => {
  const { $api } = useNuxtApp()
  // Guarded, unlike the mutations: this composable's computed runs during SSR too, where the
  // outbox plugin is not registered and there is nothing queued anyway.
  const outbox = import.meta.client ? useOutbox() : null
  const snapshot = shallowRef<WorkoutSessionWithLogs | null>(null)

  const query = useQuery<WorkoutSessionWithLogs, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.session(toValue(id)),
    query: async () => {
      const session = await $api<WorkoutSessionWithLogs>(`/api/sessions/${toValue(id)}`)
      // Deliberately the server's own view, never the overlaid one below: pending ops are laid
      // back over the snapshot on every read, so baking them in would leave a discarded op's set
      // in the snapshot for good. A store that refuses the write must not fail the fetch either
      // -- the page has the session in hand regardless, it just won't survive a cold start.
      if (import.meta.client) void saveSnapshot(session).catch(() => undefined)
      return session
    },
    enabled: () => toValue(id) !== '',
  })

  if (import.meta.client) {
    watch(() => toValue(id), async (sessionId) => {
      // Cleared before the read, not after: the new session's fetch hasn't landed either, so
      // leaving the old snapshot in place would render the previous workout under this route for
      // as long as IndexedDB takes to answer.
      snapshot.value = null
      const stored = sessionId ? await loadSnapshot(sessionId).catch(() => undefined) : undefined
      // And a read for a session we have since navigated away from must not win the race back.
      if (toValue(id) === sessionId) snapshot.value = stored ?? null
    }, { immediate: true })
  }

  // Server data -- or the last snapshot, while the first fetch is in flight or after it failed
  // offline -- with everything still queued laid on top. Overlaying on read is what keeps a
  // refetch landing mid-workout from hiding a set that hasn't synced: the query cache only ever
  // holds what the server sent, and the unsent ops are added back here every time it changes.
  const data = computed<SessionWithPending | undefined>(() => {
    const base = query.data.value ?? snapshot.value
    if (!base) return undefined
    return outbox ? applyPending(base, outbox.ops.value) : base
  })

  return { ...query, data }
}
