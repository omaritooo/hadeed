import { beforeEach, describe, expect, it } from 'vitest'
import type { OutboxOp } from '~~/app/lib/outbox'
import { createOutboxRunner, nextDue } from '~~/app/lib/outbox-runner'

// These tests drive the runner through fakes: an in-memory "disk" that round-trips through
// structuredClone the way IndexedDB does, a pass-through lock, and a recorded timer. They verify
// the ordering, persistence and state-machine decisions. They do NOT verify that IndexedDB or
// navigator.locks behave as assumed -- that is Task 8's manual pass.

const START = 1_700_000_000_000

let counter = 0
const base = (sessionId = 's1', overrides: Record<string, unknown> = {}) => ({
  opId: `op-${++counter}`,
  sessionId,
  createdAt: '2026-09-14T10:00:00.000Z',
  attempts: 0,
  status: 'pending',
  lastError: null,
  nextAttemptAt: 0,
  ...overrides,
})

const logSet = (id: string, sessionId = 's1', overrides = {}) => ({
  ...base(sessionId, overrides),
  kind: 'log_set',
  payload: { id, exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' },
}) as OutboxOp

const editSet = (setLogId: string, expectedVersion = 1, sessionId = 's1', overrides = {}) => ({
  ...base(sessionId, overrides),
  kind: 'edit_set',
  payload: { setLogId, expectedVersion, corrections: { reps: 10 } },
}) as OutboxOp

const deleteSet = (setLogId: string, sessionId = 's1', overrides = {}) => ({
  ...base(sessionId, overrides),
  kind: 'delete_set',
  payload: { setLogId },
}) as OutboxOp

const completeSession = (sessionId = 's1', overrides = {}) => ({
  ...base(sessionId, overrides),
  kind: 'complete_session',
  payload: { expectedVersion: 1, completedAt: '2026-09-14T11:00:00.000Z' },
}) as OutboxOp

const httpError = (status: number, statusMessage?: string) =>
  Object.assign(new Error(statusMessage ?? `HTTP ${status}`), {
    response: { status },
    statusCode: status,
    data: statusMessage ? { statusMessage } : undefined,
  })

// Enough microtask turns for the runner's own awaits (load, save, notify) to settle.
const tick = async (turns = 20) => { for (let i = 0; i < turns; i++) await Promise.resolve() }

// ofetch leaves `response` undefined when the request never reached a server.
const networkError = () => new Error('fetch failed')

interface HarnessOptions {
  disk?: OutboxOp[]
  send?: (op: OutboxOp) => unknown
  /** Delays a read *after* it has snapshotted the store, the way a slow IndexedDB read does. */
  onLoad?: () => Promise<void>
  /** Stands in for a store that cannot be read at all (private browsing, a blocked upgrade). */
  loadFails?: boolean
  /** Stands in for a store that accepts no writes -- a quota wall, or a blocked upgrade. */
  saveFails?: boolean
  /** Observes queue state at the moment a session is invalidated. */
  onInvalidate?: (sessionId: string) => void
}

const harness = (options: HarnessOptions = {}) => {
  let disk: OutboxOp[] = structuredClone(options.disk ?? [])
  const sends: { op: OutboxOp, diskAtSend: OutboxOp[] }[] = []
  const invalidated: string[] = []
  const timers: (number | null)[] = []
  let clock = START

  const runner = createOutboxRunner({
    load: async () => {
      if (options.loadFails) throw new Error('IndexedDB unavailable')
      const snapshot = structuredClone(disk)
      await options.onLoad?.()
      return snapshot
    },
    save: async (ops) => {
      if (options.saveFails) throw new Error('QuotaExceededError')
      disk = structuredClone(ops)
    },
    send: async (op) => {
      sends.push({ op: structuredClone(op), diskAtSend: structuredClone(disk) })
      return options.send ? options.send(op) : {}
    },
    invalidate: async (sessionId) => {
      options.onInvalidate?.(sessionId)
      invalidated.push(sessionId)
    },
    withLock: run => run(),
    setTimer: (ms) => { timers.push(ms) },
    now: () => clock,
  })

  return {
    runner,
    sends,
    invalidated,
    timers,
    get disk() { return disk },
    get kinds() { return sends.map(s => s.op.kind) },
    advance: (ms: number) => { clock += ms },
    get clock() { return clock },
  }
}

beforeEach(() => { counter = 0 })

describe('nextDue', () => {
  it('holds back a whole session while its head op waits out a backoff', () => {
    // The set has to land before the session that contains it completes. Picking the first *due*
    // op rather than the first due *head* op is what lets a completion overtake a retrying set.
    const set = logSet('a', 's1', { nextAttemptAt: START + 4000 })
    const complete = completeSession('s1')
    expect(nextDue([set, complete], START)).toBeUndefined()
    expect(nextDue([set, complete], START + 4000)).toBe(set)
  })

  it('skips a session blocked by a failed op but still serves another session', () => {
    const blocked = logSet('a', 's1', { status: 'failed' })
    const behind = completeSession('s1')
    const other = logSet('b', 's2')
    expect(nextDue([blocked, behind, other], START)).toBe(other)
  })

  it('offers a sending op back up, since only a dead tab leaves one behind', () => {
    const stranded = logSet('a', 's1', { status: 'sending' })
    expect(nextDue([stranded], START)).toBe(stranded)
  })

  it('takes sessions in queue order', () => {
    const first = logSet('a', 's2')
    const second = logSet('b', 's1')
    expect(nextDue([first, second], START)).toBe(first)
  })
})

describe('flush ordering and persistence', () => {
  it('sends a session queue serially, in order', async () => {
    const h = harness({ disk: [logSet('a'), editSet('a'), completeSession()] })
    await h.runner.start()
    expect(h.kinds).toEqual(['log_set', 'edit_set', 'complete_session'])
    expect(h.disk).toEqual([])
  })

  it('persists the op as sending before its request goes out', async () => {
    const h = harness({ disk: [logSet('a')] })
    await h.runner.start()
    const [attempt] = h.sends
    // The lifter's phone can die between these two lines; what is on disk has to be enough to
    // replay the op, never enough to consider it done.
    expect(attempt!.diskAtSend).toHaveLength(1)
    expect(attempt!.diskAtSend[0]).toMatchObject({ status: 'sending', attempts: 1 })
  })

  it('replays an op left sending by a tab that died mid-request', async () => {
    const h = harness({ disk: [logSet('a', 's1', { status: 'sending', attempts: 1 })] })
    await h.runner.start()
    expect(h.kinds).toEqual(['log_set'])
    expect(h.disk).toEqual([])
  })

  it('does not lose an op enqueued while a request is in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const h = harness({ disk: [logSet('a')], send: op => (op.kind === 'log_set' ? gate : {}) })

    const flushing = h.runner.start()
    await tick()
    expect(h.sends).toHaveLength(1) // the log_set request is in flight, gated below
    await h.runner.add({ sessionId: 's1', kind: 'complete_session', payload: { expectedVersion: 1, completedAt: '2026-09-14T11:00:00.000Z' } })
    release()
    await flushing
    await h.runner.flush()

    expect(h.kinds).toEqual(['log_set', 'complete_session'])
    expect(h.disk).toEqual([])
  })

  it('does not let a slow read clobber an op enqueued while it was in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    let firstRead = true
    const h = harness({
      disk: [logSet('a')],
      onLoad: () => { if (!firstRead) return Promise.resolve(); firstRead = false; return gate },
    })

    const started = h.runner.start()
    await tick()
    // The read has already snapshotted an outbox without this set in it.
    const added = h.runner.add({ sessionId: 's1', kind: 'log_set', payload: { id: 'set-b', exerciseLogId: 'e1', setNumber: 2, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:05:00.000Z' } })
    release()
    await Promise.all([started, added])
    await h.runner.flush()

    expect(h.sends.map(s => (s.op.payload as { id: string }).id)).toEqual(['a', 'set-b'])
    expect(h.disk).toEqual([])
  })

  it('invalidates a session only once its queue has drained', async () => {
    const h = harness({ disk: [logSet('a'), completeSession()] })
    await h.runner.start()
    expect(h.invalidated).toEqual(['s1'])
  })

  // The overlay stops covering a set the moment its op leaves the queue, but the query still
  // holds the pre-write payload until the refetch lands. Dropping first makes the set blink out
  // for a round trip on every online write, so the refresh has to happen while the op is still
  // there to cover it.
  it('refreshes while the last op is still queued, so the overlay never gaps', async () => {
    const opsWhenInvalidated: string[][] = []
    const h = harness({
      disk: [logSet('a')],
      onInvalidate: () => opsWhenInvalidated.push(h.runner.state.ops.map(op => op.opId)),
    })

    await h.runner.start()

    expect(h.invalidated).toEqual(['s1'])
    // Invalidated once, with the op it just sent still in the queue covering the set.
    expect(opsWhenInvalidated).toHaveLength(1)
    expect(opsWhenInvalidated[0]).toHaveLength(1)
    expect(h.runner.state.ops).toEqual([])
  })

  it('rewrites the expected version of later edits to the same set', async () => {
    const h = harness({
      disk: [editSet('set-1', 1), editSet('set-1', 1), editSet('set-2', 1)],
      send: () => ({ version: 7 }),
    })
    await h.runner.start()
    expect(h.sends[1]!.op.payload).toMatchObject({ setLogId: 'set-1', expectedVersion: 7 })
    expect(h.sends[2]!.op.payload).toMatchObject({ setLogId: 'set-2', expectedVersion: 1 })
  })

  it('keeps the server summary of a completed session', async () => {
    const summary = { volumeKg: 1000, durationSeconds: 3600, setCount: 12 }
    const h = harness({ disk: [completeSession('s1')], send: () => ({ summary }) })
    await h.runner.start()
    expect(h.runner.state.summaries.s1).toEqual(summary)
  })
})

describe('failure handling', () => {
  it('retries a 500 with backoff and holds the rest of the session back', async () => {
    const h = harness({
      disk: [logSet('a'), completeSession()],
      send: (op) => { if (op.kind === 'log_set') throw httpError(500) },
    })
    await h.runner.start()

    expect(h.kinds).toEqual(['log_set'])
    const [queued] = h.disk
    expect(queued).toMatchObject({ kind: 'log_set', status: 'pending', attempts: 1 })
    expect(queued!.nextAttemptAt).toBe(START + 1000)
    // The wake is the backoff, not the 30s poll.
    expect(h.timers.at(-1)).toBe(1000)

    // And a trigger arriving mid-backoff must not let the completion overtake the set.
    h.advance(500)
    await h.runner.flush()
    expect(h.kinds).toEqual(['log_set'])
  })

  it('treats a request that never got a response as retryable', async () => {
    const h = harness({ disk: [logSet('a')], send: () => { throw networkError() } })
    await h.runner.start()
    expect(h.disk[0]).toMatchObject({ status: 'pending', attempts: 1, lastError: null })
  })

  it('grows the backoff across attempts', async () => {
    const h = harness({ disk: [logSet('a')], send: () => { throw httpError(503) } })
    await h.runner.start()
    h.advance(1000)
    await h.runner.flush()
    expect(h.disk[0]).toMatchObject({ attempts: 2 })
    expect(h.disk[0]!.nextAttemptAt).toBe(h.clock + 2000)
  })

  it('pauses the queue on a 401 and keeps every op', async () => {
    const h = harness({
      disk: [logSet('a'), completeSession()],
      send: () => { throw httpError(401) },
    })
    await h.runner.start()

    expect(h.runner.state.paused).toBe(true)
    expect(h.disk).toHaveLength(2)
    expect(h.sends).toHaveLength(1)
    // A paused queue waits for a login, not for a clock.
    expect(h.timers.at(-1)).toBeNull()

    await h.runner.flush()
    expect(h.sends).toHaveLength(1)
  })

  it('resumes after a login and retries immediately', async () => {
    let status = 401
    const h = harness({ disk: [logSet('a')], send: () => { if (status) throw httpError(status) } })
    await h.runner.start()
    status = 0
    await h.runner.resume()
    expect(h.sends).toHaveLength(2)
    expect(h.disk).toEqual([])
  })

  it('drops an edit the server refused as a conflict and tells the page', async () => {
    const h = harness({
      disk: [editSet('set-1'), completeSession()],
      send: (op) => { if (op.kind === 'edit_set') throw httpError(409, 'Set was modified elsewhere; check sync conflicts') },
    })
    await h.runner.start()

    expect(h.runner.state.notices).toHaveLength(1)
    expect(h.kinds).toEqual(['edit_set', 'complete_session'])
    expect(h.disk).toEqual([])
    expect(h.invalidated).toContain('s1')
  })

  it('fails a completion the server refused as a conflict', async () => {
    const h = harness({ disk: [completeSession()], send: () => { throw httpError(409, 'Session was modified elsewhere; check sync conflicts') } })
    await h.runner.start()
    expect(h.disk[0]).toMatchObject({ status: 'failed', lastError: 'Session was modified elsewhere; check sync conflicts' })
  })

  it('treats a 404 on a delete as the delete having already happened', async () => {
    const h = harness({ disk: [deleteSet('set-1'), completeSession()], send: (op) => { if (op.kind === 'delete_set') throw httpError(404) } })
    await h.runner.start()
    expect(h.disk).toEqual([])
    expect(h.runner.state.notices).toEqual([])
  })

  it('fails on another 4xx, blocking that session but not the others', async () => {
    const h = harness({
      disk: [logSet('a', 's1'), completeSession('s1'), logSet('b', 's2')],
      send: op => (op.sessionId === 's1' && op.kind === 'log_set' ? (() => { throw httpError(400, 'Bad request') })() : {}),
    })
    await h.runner.start()

    expect(h.kinds).toEqual(['log_set', 'log_set'])
    expect(h.disk.map(o => o.sessionId)).toEqual(['s1', 's1'])
    expect(h.disk[0]).toMatchObject({ status: 'failed', lastError: 'Bad request' })
  })

  it('retries a failed op on demand and clears its error', async () => {
    let failing = true
    const h = harness({ disk: [logSet('a')], send: () => { if (failing) throw httpError(400, 'Bad request') } })
    await h.runner.start()
    const failed = h.disk[0]!

    failing = false
    await h.runner.retry(failed.opId)
    expect(h.disk).toEqual([])
    expect(h.sends).toHaveLength(2)
  })

  it('discards a failed op and refreshes the session', async () => {
    const h = harness({ disk: [logSet('a')], send: () => { throw httpError(400, 'Bad request') } })
    await h.runner.start()
    await h.runner.discard(h.disk[0]!.opId)
    expect(h.disk).toEqual([])
    expect(h.invalidated).toContain('s1')
  })
})

describe('scheduling', () => {
  it('stops the timer once the queue is empty', async () => {
    const h = harness({ disk: [logSet('a')] })
    await h.runner.start()
    expect(h.timers.at(-1)).toBeNull()
  })

  it('leaves no timer running when every remaining op needs the lifter', async () => {
    const h = harness({ disk: [logSet('a', 's1', { status: 'failed' }), completeSession('s1'), logSet('b', 's2')] })
    await h.runner.start()
    // s2 drained; s1 is blocked behind a failed op, which only a manual retry clears.
    expect(h.timers.at(-1)).toBeNull()
  })

  it('wakes at the 30s poll when the only pending op is far in the future', async () => {
    const h = harness({ disk: [logSet('a', 's1', { nextAttemptAt: START + 5 * 60_000 })] })
    await h.runner.start()
    expect(h.sends).toEqual([])
    expect(h.timers.at(-1)).toBe(30_000)
  })

  it('clears the backoff when the network comes back but keeps the attempt count', async () => {
    let failing = true
    const h = harness({ disk: [logSet('a')], send: () => { if (failing) throw networkError() } })
    await h.runner.start()
    expect(h.disk[0]!.nextAttemptAt).toBe(START + 1000)

    failing = false
    await h.runner.reconnected()
    expect(h.sends).toHaveLength(2)
    expect(h.sends[1]!.op.attempts).toBe(2)
    expect(h.disk).toEqual([])
  })
})

describe('add', () => {
  it('still sends from memory when the store cannot be read', async () => {
    const h = harness({ loadFails: true })
    await h.runner.start()
    await h.runner.add({ sessionId: 's1', kind: 'log_set', payload: { id: 'set-1', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' } })
    await h.runner.flush()
    expect(h.kinds).toEqual(['log_set'])
  })

  // Why the mutation composables surface a rejected `add` instead of swallowing it: the op does
  // survive in memory, but only until the next pass, which begins by reloading the queue from a
  // disk that never received it. "It will sync anyway" holds when the store cannot be *read*
  // (the test above); it does not hold when the store simply refuses writes.
  it('loses an op the store refused, on the next pass', async () => {
    const h = harness({ saveFails: true })
    await h.runner.start()
    await expect(h.runner.add({ sessionId: 's1', kind: 'log_set', payload: { id: 'set-1', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' } })).rejects.toThrow()
    expect(h.runner.state.ops.map(o => o.kind)).toEqual(['log_set'])
    expect(h.kinds).toEqual([])
    // The reload at the top of the pass overwrites the unpersisted op, and it is never sent.
    await h.runner.flush()
    expect(h.runner.state.ops).toEqual([])
    expect(h.kinds).toEqual([])
  })

  it('enqueues a new op and flushes it', async () => {
    const h = harness()
    await h.runner.start()
    await h.runner.add({ sessionId: 's1', kind: 'log_set', payload: { id: 'set-1', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' } })
    await h.runner.flush()
    expect(h.kinds).toEqual(['log_set'])
    expect(h.sends[0]!.op.opId).toEqual(expect.any(String))
  })
})

describe('reset', () => {
  // A queue that cannot reach the server, which is the state a lifter signing out offline is in.
  const stranded = (disk: OutboxOp[]) => harness({ disk, send: () => { throw networkError() } })

  it('drops the queue this tab is holding, so the next write cannot save it back', async () => {
    const h = stranded([logSet('set-1'), completeSession('s2')])
    await h.runner.start()
    expect(h.runner.state.ops).toHaveLength(2)

    await h.runner.reset()

    expect(h.runner.state.ops).toEqual([])
    // The clear reaches disk too: leaving it to `clearOutbox` alone would let this write, made
    // from the in-memory copy, put the departed account's ops straight back.
    expect(h.disk).toEqual([])
    // Nothing is waiting, so nothing is left ticking.
    expect(h.timers.at(-1)).toBeNull()
    // A second account's set enqueues into an empty queue, not behind the first account's.
    await h.runner.add({ sessionId: 's9', kind: 'log_set', payload: { id: 'set-9', exerciseLogId: 'e9', setNumber: 1, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' } })
    expect(h.disk.map(o => o.sessionId)).toEqual(['s9'])
  })

  it('clears the paused flag and the notices the previous account left behind', async () => {
    const h = harness({ disk: [editSet('set-1')], send: () => { throw httpError(401) } })
    await h.runner.start()
    expect(h.runner.state.paused).toBe(true)

    await h.runner.reset()

    expect(h.runner.state.paused).toBe(false)
    expect(h.runner.state.notices).toEqual([])
    expect(h.runner.state.summaries).toEqual({})
  })

  it('leaves subscribers looking at the empty queue', async () => {
    const h = stranded([logSet('set-1')])
    const seen: number[] = []
    h.runner.subscribe(state => seen.push(state.ops.length))
    await h.runner.start()
    await h.runner.reset()
    expect(seen.at(-1)).toBe(0)
  })
})
