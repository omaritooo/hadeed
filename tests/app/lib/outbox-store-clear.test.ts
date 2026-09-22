// A real IndexedDB, in memory: the point of these tests is what is actually left on disk after a
// sign-out, which a mocked store could only assert about itself.
import 'fake-indexeddb/auto'
import type { OutboxOp } from '~~/app/lib/outbox'
import type { WorkoutSessionWithLogs } from '~~/shared/types/session.types'
import { createStore, keys } from 'idb-keyval'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearOutbox, loadOps, loadSnapshot, saveOps, saveSnapshot } from '~~/app/lib/outbox-store'

const op = (opId: string, sessionId: string): OutboxOp => ({
  opId,
  sessionId,
  kind: 'log_set',
  payload: { id: `set-${opId}`, exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' },
  createdAt: '2026-09-14T10:00:00.000Z',
  attempts: 0,
  status: 'pending',
  lastError: null,
  nextAttemptAt: 0,
} as OutboxOp)

const session = (id: string): WorkoutSessionWithLogs => ({ id, exercises: [] } as unknown as WorkoutSessionWithLogs)

// The same database and object store the module opens, so the assertions read what it wrote.
const store = createStore('hadeed', 'outbox')

beforeEach(async () => {
  await clearOutbox()
})

describe('clearOutbox', () => {
  it('leaves nothing behind for the next account on the phone', async () => {
    await saveOps([op('op-1', 's1'), op('op-2', 's2')])
    await saveSnapshot(session('s1'))
    await saveSnapshot(session('s2'))

    // Everything the store holds, enumerated rather than assumed: the queue plus a snapshot per
    // session the previous user opened.
    expect((await keys(store)).map(String).sort()).toEqual(['ops', 'session:s1', 'session:s2'])

    await clearOutbox()

    expect(await keys(store)).toEqual([])
    expect(await loadOps()).toEqual([])
    expect(await loadSnapshot('s1')).toBeUndefined()
    expect(await loadSnapshot('s2')).toBeUndefined()
  })

  it('is safe to call on a store that holds nothing', async () => {
    await expect(clearOutbox()).resolves.toBeUndefined()
    expect(await keys(store)).toEqual([])
  })
})
