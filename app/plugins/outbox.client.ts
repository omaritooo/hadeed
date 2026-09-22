import type { OutboxOp } from '~~/app/lib/outbox'
import type { SessionCompletionSummary, SetLog } from '~~/shared/types/session.types'
import { useQueryCache } from '@pinia/colada'
import { createOutboxRunner } from '~~/app/lib/outbox-runner'
import { clearOutbox, loadOps, saveOps } from '~~/app/lib/outbox-store'

const LOCK_NAME = 'hadeed-outbox'

/**
 * Serialises flush passes. Web Locks does it across tabs; where it is missing — iOS Safari before
 * 15.4, and any non-secure context, both of which a phone-first PWA still meets in the wild — a
 * promise chain serialises this tab's own passes, which is what the in-order invariant actually
 * needs. Two tabs could then flush at once: the cost is a duplicate request, not a duplicate row,
 * since every op carries a client-generated id and the server treats a replay as idempotent.
 * Calling a missing `navigator.locks` would throw on every trigger and silently never sync, which
 * is the one outcome that loses the lifter's sets.
 */
const createLock = () => {
  const locks = typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(run: () => Promise<T>): Promise<T> => {
    if (locks) return locks.request(LOCK_NAME, run) as Promise<T>
    const next = chain.then(run, run)
    chain = next.catch(() => undefined)
    return next
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const { $api } = useNuxtApp()
  // Resolved from the app's own pinia: a plugin has no component instance for the store to infer.
  const queryCache = useQueryCache(nuxtApp.$pinia)

  const send = (op: OutboxOp): Promise<unknown> => {
    const base = `/api/sessions/${op.sessionId}`
    switch (op.kind) {
      case 'log_set':
        return $api<SetLog>(`${base}/sets`, { method: 'POST', body: op.payload })
      case 'edit_set':
        return $api<SetLog>(`${base}/sets/${op.payload.setLogId}`, {
          method: 'PATCH',
          body: { expectedVersion: op.payload.expectedVersion, ...op.payload.corrections },
        })
      case 'delete_set':
        return $api(`${base}/sets/${op.payload.setLogId}`, { method: 'DELETE' })
      case 'complete_session':
        return $api<{ summary: SessionCompletionSummary }>(`${base}/complete`, { method: 'POST', body: op.payload })
    }
  }

  // The same three keys the online mutations invalidate: a set moves this session's log, the
  // workouts summary, and home's weekly volume and XP bar. allSettled, because the write has
  // already landed — a refetch that fails must not be reported as a sync failure.
  const invalidate = async (sessionId: string) => {
    await Promise.allSettled([
      queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
      queryCache.invalidateQueries({ key: queryKeys.workouts() }),
      queryCache.invalidateQueries({ key: queryKeys.home() }),
    ])
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const setTimer = (ms: number | null) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    // The runner clears the wake whenever nothing is waiting, so an app sitting on an empty queue
    // leaves no timer ticking behind it.
    if (ms !== null) timer = setTimeout(() => void runner.flush(), ms)
  }

  const runner = createOutboxRunner({
    load: loadOps,
    save: saveOps,
    send,
    invalidate,
    withLock: createLock(),
    setTimer,
  })

  const ops = shallowRef<OutboxOp[]>([])
  const syncing = ref(false)
  const paused = ref(false)
  const notices = shallowRef<string[]>([])
  const serverSummaries = reactive<Record<string, SessionCompletionSummary>>({})
  const online = ref(navigator.onLine)

  runner.subscribe((state) => {
    ops.value = state.ops
    syncing.value = state.syncing
    paused.value = state.paused
    notices.value = state.notices
    Object.assign(serverSummaries, state.summaries)
  })

  window.addEventListener('online', () => {
    online.value = true
    void runner.reconnected()
  })
  window.addEventListener('offline', () => { online.value = false })
  // Covers the phone that was locked mid-sync: coming back to the tab is the moment the lifter
  // expects their sets to be on their way.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runner.flush()
  })

  void runner.start()

  return {
    provide: {
      outbox: {
        ops,
        online,
        syncing,
        paused,
        notices,
        serverSummaries,
        add: runner.add,
        flush: runner.flush,
        retry: runner.retry,
        discard: runner.discard,
        resume: runner.resume,
        dismissNotices: runner.dismissNotices,
        // Sign-out. Both halves matter and neither is enough alone: the store holds the queue and
        // the session snapshots the departed account left on the phone, and the runner holds this
        // tab's own copy of the queue, which the next write would save straight back over the
        // cleared store. Cleared first, so a write racing in from a flush already in flight lands
        // before the store is emptied rather than after it.
        reset: async () => {
          await runner.reset()
          // The subscriber above merges summaries in with `Object.assign`, which can add a key but
          // never remove one, so the completed workouts of the account that just left are dropped
          // by hand here.
          for (const sessionId of Object.keys(serverSummaries)) Reflect.deleteProperty(serverSummaries, sessionId)
          await clearOutbox()
        },
      },
    },
  }
})
