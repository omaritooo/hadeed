import type { FetchError } from "ofetch"
import type { OutboxOp, OutboxStatus } from "~~/app/lib/outbox"
import type { SessionCompletionSummary, SetLog } from "~~/shared/types/session.types"
import { backoffMs, classify, enqueue } from "~~/app/lib/outbox"
import { clampAttempts } from "~~/app/lib/outbox-store"

// Poll while work is queued: `online` does not fire for every way a connection comes back (a cell
// handoff, a captive portal that lets go, a server that was down), and a lifter who put the phone
// in a pocket mid-workout should find the queue drained when they take it out.
const POLL_MS = 30_000
// No wake is ever scheduled sooner than this, so a store or lock that keeps failing costs one
// attempt a second rather than a spin.
const MIN_WAKE_MS = 1_000

const CONFLICT_NOTICE = "A set was changed on another device — your offline edit wasn't applied."

// `Omit` over a union collapses it into one object type, which would let a caller pair
// `kind: 'log_set'` with a completion payload. Distributing keeps each kind bound to its payload.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** An op as a caller supplies it: the queue owns the identity and the retry bookkeeping. */
export type NewOp = DistributiveOmit<OutboxOp, "opId" | "createdAt" | "attempts" | "status" | "lastError" | "nextAttemptAt">

export interface OutboxState {
  ops: OutboxOp[]
  syncing: boolean
  /** Set on a 401 and cleared by a login: the queue is intact, it just cannot be sent. */
  paused: boolean
  notices: string[]
  summaries: Record<string, SessionCompletionSummary>
}

export interface OutboxRunnerDeps {
  load: () => Promise<OutboxOp[]>
  save: (ops: OutboxOp[]) => Promise<void>
  send: (op: OutboxOp) => Promise<unknown>
  /** Refetch a session's queries. Must resolve, never reject -- a refetch is not the op failing. */
  invalidate: (sessionId: string) => Promise<void>
  /** Runs one flush pass under a cross-tab lock. */
  withLock: <T>(run: () => Promise<T>) => Promise<T>
  /** Arms the next wake, or clears it when given null. */
  setTimer: (ms: number | null) => void
  now?: () => number
}

interface OpRevision {
  status?: OutboxStatus
  attempts?: number
  nextAttemptAt?: number
  lastError?: string | null
}

const revise = (op: OutboxOp, changes: OpRevision): OutboxOp => ({ ...op, ...changes }) as OutboxOp

/** The first queued op of each session, in queue order. */
const headOps = (ops: OutboxOp[]): OutboxOp[] => {
  const heads = new Map<string, OutboxOp>()
  for (const op of ops) if (!heads.has(op.sessionId)) heads.set(op.sessionId, op)
  return [...heads.values()]
}

/**
 * The next op to send: the head of some session's queue, taking sessions in queue order and
 * skipping any whose head has failed or is waiting out a backoff.
 *
 * Only a *head* op is ever eligible, which is what keeps replay in order per session: a set has
 * to reach the server before the session containing it completes. Testing `nextAttemptAt` per op
 * instead of per session is the subtle version of this bug -- a `log_set` backing off after a 500
 * would let the `complete_session` behind it go out first, completing a workout without its last
 * set. A 'sending' op *is* eligible: the loop is serial and holds the lock while a request is
 * genuinely in flight, so one found on disk was left by a tab that died mid-request.
 */
export const nextDue = (ops: OutboxOp[], at: number): OutboxOp | undefined =>
  headOps(ops).find(op => op.status !== "failed" && op.nextAttemptAt <= at)

/**
 * ofetch sets `response` only when a server actually answered. A network failure leaves it
 * undefined, which `classify` reads as "retry" rather than as a permanent failure -- exactly the
 * case the outbox exists for.
 */
const readFailure = (error: unknown) => {
  const failure = error as FetchError<{ statusMessage?: string }> | undefined
  const statusCode = failure?.response ? failure.statusCode : undefined
  return {
    statusCode,
    message: failure?.data?.statusMessage ?? (statusCode === undefined ? "Couldn't reach the server" : `HTTP ${statusCode}`),
  }
}

export const createOutboxRunner = (deps: OutboxRunnerDeps) => {
  const now = deps.now ?? (() => Date.now())
  const state: OutboxState = { ops: [], syncing: false, paused: false, notices: [], summaries: {} }
  const listeners = new Set<(state: OutboxState) => void>()
  const notify = () => { for (const listener of listeners) listener(state) }

  // Every read-modify-write of the queue runs through this chain. Without it, an enqueue that
  // lands while the flush loop is awaiting a request (or awaiting IndexedDB) can interleave
  // between the loop's read of `state.ops` and its write back, and the later write silently drops
  // the new op -- a set the lifter logged, gone. It also means the reload at the top of a flush
  // can never race a local write that has not reached disk yet.
  let chain: Promise<unknown> = Promise.resolve()
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const next = chain.then(run, run)
    chain = next.catch(() => undefined)
    return next
  }

  const write = (update: (ops: OutboxOp[]) => OutboxOp[]) => serialize(async () => {
    state.ops = update(state.ops)
    notify()
    await deps.save(state.ops)
  })

  // A store that cannot be read -- Safari private browsing, a blocked upgrade, a quota wall --
  // must not take the queue down with it. The in-memory view is then the best one available, and
  // sending from it risks a duplicate request (which the server replays idempotently) rather than
  // never syncing at all.
  const reload = () => serialize(async () => {
    state.ops = await deps.load()
    notify()
  }).catch(() => undefined)

  // A refetch failing is not the op failing: the write already landed. Same reason the mutation
  // composables invalidate through `Promise.allSettled`.
  const refresh = (sessionId: string) => deps.invalidate(sessionId).catch(() => undefined)

  const scheduleWake = () => {
    // A paused queue is waiting for a login, not for a clock, and a failed op is waiting for the
    // lifter to hit Retry -- neither gets a timer, so an idle app is not left with one running.
    const waiting = state.paused ? [] : headOps(state.ops).filter(op => op.status !== "failed")
    if (waiting.length === 0) {
      deps.setTimer(null)
      return
    }
    const due = Math.min(...waiting.map(op => op.nextAttemptAt))
    deps.setTimer(Math.min(POLL_MS, Math.max(MIN_WAKE_MS, due - now())))
  }

  /**
   * Persisted before the request goes out, with the attempt already counted. If the phone dies
   * mid-flight, what is on disk is enough to replay the op and never enough to consider it done:
   * an op is only removed after a response is in hand. The opposite order (send, then persist)
   * loses the op outright when the tab is evicted between the two, and replays are idempotent
   * server-side, so at-least-once is the safe side to err on.
   */
  const markSending = async (op: OutboxOp) => {
    const attempts = clampAttempts(op.attempts)
    await write(ops => ops.map(o => (o.opId === op.opId
      ? revise(o, { status: "sending", attempts: attempts + 1, nextAttemptAt: now() + backoffMs(attempts) })
      : o)))
    return state.ops.find(o => o.opId === op.opId) ?? op
  }

  const onSent = async (op: OutboxOp, response: unknown) => {
    if (op.kind === "complete_session") {
      const summary = (response as { summary?: SessionCompletionSummary } | undefined)?.summary
      if (summary) {
        state.summaries = { ...state.summaries, [op.sessionId]: summary }
        notify()
      }
    }
    // Refreshed *before* the op is dropped, and only when it is the last one for this session.
    // applyPending stops covering the set the instant the op leaves the queue, while the query
    // still holds the pre-write payload until the refetch lands -- dropping first makes a set the
    // lifter just logged blink out for a round trip on every online write.
    if (!state.ops.some(o => o.sessionId === op.sessionId && o.opId !== op.opId)) await refresh(op.sessionId)
    await write((ops) => {
      const remaining = ops.filter(o => o.opId !== op.opId)
      if (op.kind !== "edit_set") return remaining
      // Later edits of this set were queued against the version this one just superseded, so
      // each would come back 409 over a row only this queue has touched.
      const version = (response as SetLog | undefined)?.version
      if (typeof version !== "number") return remaining
      return remaining.map(o => (o.kind === "edit_set" && o.payload.setLogId === op.payload.setLogId
        ? { ...o, payload: { ...o.payload, expectedVersion: version } }
        : o))
    })
  }

  /**
   * Returns whether the flush pass should carry on to the next session. `priorAttempts` is the
   * count from before this try, so the first retry waits a second rather than two.
   */
  const onFailed = async (op: OutboxOp, priorAttempts: number, error: unknown): Promise<boolean> => {
    const { statusCode, message } = readFailure(error)
    const action = classify({ ok: false, statusCode })
    const drop = (ops: OutboxOp[]) => ops.filter(o => o.opId !== op.opId)

    if (action === "retry" || action === "auth") {
      const delay = backoffMs(priorAttempts)
      await write(ops => ops.map(o => (o.opId === op.opId ? revise(o, { status: "pending", nextAttemptAt: now() + delay }) : o)))
      if (action === "auth") {
        state.paused = true
        notify()
      }
      return false
    }

    if (action === "conflict" && op.kind === "edit_set") {
      // Server wins, and the conflict is already recorded server-side; the page tells the lifter
      // so the value they typed does not silently revert on the next refetch.
      state.notices = [...state.notices, CONFLICT_NOTICE]
      notify()
      await write(drop)
      await refresh(op.sessionId)
      return true
    }

    if (op.kind === "delete_set" && statusCode === 404) {
      // The row is already gone -- most often this delete is a replay whose first response was
      // lost. Nothing to report.
      await write(drop)
      return true
    }

    // Anything else (a 409 on a completion, a 4xx the server means) needs the lifter: the op sits
    // as failed with Retry / Discard, and its session's queue stays behind it, in order.
    await write(ops => ops.map(o => (o.opId === op.opId ? revise(o, { status: "failed", lastError: message }) : o)))
    return true
  }

  const attempt = async (op: OutboxOp): Promise<boolean> => {
    const priorAttempts = clampAttempts(op.attempts)
    const sending = await markSending(op)
    let response: unknown
    try {
      response = await deps.send(sending)
    }
    catch (error) {
      return await onFailed(sending, priorAttempts, error)
    }
    // Deliberately outside the try: a store that fails *after* a successful response is not the
    // op failing. Letting it throw leaves the op on disk as 'sending' for the next pass to
    // replay, rather than classifying a write that landed as a network failure.
    await onSent(sending, response)
    return true
  }

  const pass = async () => {
    if (state.paused) return
    state.syncing = true
    notify()
    try {
      await deps.withLock(async () => {
        // Another tab -- or this tab's previous life -- may have drained ops since we last looked.
        await reload()

        for (let op = nextDue(state.ops, now()); op; op = nextDue(state.ops, now())) {
          if (!await attempt(op)) return
        }
      })
    }
    catch {
      // The lock was unavailable or the store threw. The queue is untouched on disk, so the next
      // trigger (or the wake armed below) tries again rather than losing anything.
    }
    finally {
      state.syncing = false
      notify()
      scheduleWake()
    }
  }

  let running: Promise<void> | undefined
  let rerun = false

  /**
   * One pass at a time. A trigger that arrives mid-pass is not dropped: it joins the current pass
   * and, if that pass had already looked past the new op, runs another once it finishes.
   */
  const flush = (): Promise<void> => {
    if (running) {
      rerun = true
      return running
    }
    const loop = async (): Promise<void> => {
      await pass()
      if (rerun) {
        rerun = false
        await loop()
      }
    }
    running = loop().finally(() => { running = undefined })
    return running
  }

  const start = async () => {
    await reload()
    scheduleWake()
    await flush()
  }

  const add = async (op: NewOp) => {
    const full = {
      ...op,
      opId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: "pending",
      lastError: null,
      nextAttemptAt: 0,
    } as OutboxOp
    await write(ops => enqueue(ops, full))
    void flush()
    return full
  }

  const clearBackoff = () => write(ops => ops.map(o => (o.status === "pending" ? revise(o, { nextAttemptAt: 0 }) : o)))

  /**
   * The network coming back invalidates the reason for the current wait, but not the attempt
   * count: if it is the server that is unhappy, the backoff keeps growing from where it left off.
   */
  const reconnected = async () => {
    await clearBackoff()
    await flush()
  }

  const resume = async () => {
    state.paused = false
    notify()
    await clearBackoff()
    await flush()
  }

  const retry = async (opId: string) => {
    state.paused = false
    await write(ops => ops.map(o => (o.opId === opId ? revise(o, { status: "pending", attempts: 0, nextAttemptAt: 0, lastError: null }) : o)))
    await flush()
  }

  const discard = async (opId: string) => {
    const op = state.ops.find(o => o.opId === opId)
    await write(ops => ops.filter(o => o.opId !== opId))
    if (op) await refresh(op.sessionId)
  }

  const dismissNotices = () => {
    state.notices = []
    notify()
  }

  const subscribe = (listener: (state: OutboxState) => void) => {
    listeners.add(listener)
    listener(state)
    return () => listeners.delete(listener)
  }

  return { state, subscribe, start, flush, add, retry, discard, resume, reconnected, dismissNotices }
}

export type OutboxRunner = ReturnType<typeof createOutboxRunner>
