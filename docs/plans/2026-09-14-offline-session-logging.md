# Offline Session Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A workout started online can be logged to the end offline: log, edit and delete sets, then finish. Everything syncs when the connection returns.

**Architecture:** Every session write goes through an IndexedDB-backed outbox (`app/plugins/outbox.client.ts`). Its pure logic (`app/lib/outbox.ts`) merges ops, overlays pending ops onto the session query, and classifies replay results. The server accepts client timestamps and makes replayed edits and completes idempotent. The service worker caches the session page and its GET reads, and the auth middleware stops treating offline as logged out.

**Tech Stack:** Nuxt 4, `@pinia/colada`, `idb-keyval`, Workbox 7.4 (`workbox-routing`, `workbox-strategies`, `workbox-expiration`), Web Locks API, Vitest.

**Design doc:** `docs/plans/2026-09-14-offline-session-logging-design.md`

---

## Before you start

- **Run after** `2026-09-14-progression-and-prs.md` and `2026-09-14-week-streaks.md`. This
  plan edits `SessionService.logSet` / `completeSession` and `server/utils/session-service.ts`
  as those plans leave them.
- **Scope change from the design:** no `add_exercise` op. `POST /api/sessions/:id/exercises`
  has no client caller today, so there is nothing to queue.
- `npx vitest run` green before Task 1. Commit on `main`, explicit paths, messages ending
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Manual offline testing: Chrome DevTools → Application → Service Workers (confirm
  registered) and Network → "Offline". The PWA dev SW is enabled (`devOptions.enabled: true`).

---

### Task 1: Server — client `loggedAt` / `completedAt`, clamped

**Files:**
- Modify: `server/utils/date.ts` (add `parseClientTimestamp`)
- Modify: `server/repositories/session.repository.ts` (`LogSetInput`, `logSet`, `completeSession`)
- Modify: `server/services/session.service.ts` (`completeSession` signature)
- Modify: `server/api/sessions/[id]/sets.post.ts`, `server/api/sessions/[id]/complete.post.ts`
- Tests: `tests/server/utils/date.test.ts`, `tests/server/repositories/session.repository.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/server/utils/date.test.ts
describe('parseClientTimestamp', () => {
  it('converts an ISO string to SQLite datetime format', () => {
    expect(parseClientTimestamp('2026-09-14T10:15:30.123Z')).toBe('2026-09-14 10:15:30')
  })

  it('returns null for missing or invalid input', () => {
    expect(parseClientTimestamp(undefined)).toBeNull()
    expect(parseClientTimestamp('not a date')).toBeNull()
  })
})
```

```ts
// session.repository.test.ts
describe('client timestamps', () => {
  let db: Client
  let repo: SessionRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await db.execute(`UPDATE workout_sessions SET started_at = '2026-09-14 10:00:00' WHERE id = 's1'`)
    await repo.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
  })

  it('stores a client loggedAt inside the session window', async () => {
    const set = await repo.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null, loggedAt: '2026-09-14 10:20:00' })
    expect(set.loggedAt).toBe('2026-09-14 10:20:00')
  })

  it('clamps a loggedAt before the session started', async () => {
    const set = await repo.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null, loggedAt: '2026-09-13 09:00:00' })
    expect(set.loggedAt).toBe('2026-09-14 10:00:00')
  })

  it('clamps a loggedAt in the future to now', async () => {
    const set = await repo.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null, loggedAt: '2999-01-01 00:00:00' })
    expect(set.loggedAt < '2999-01-01 00:00:00').toBe(true)
  })

  it('stores a clamped client completedAt', async () => {
    const result = await repo.completeSession('s1', 1, '2026-09-14 11:05:00')
    expect(result.conflict).toBe(false)
    if (!result.conflict) expect(result.session.completedAt).toBe('2026-09-14 11:05:00')
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/utils/date.test.ts tests/server/repositories/session.repository.test.ts -t "timestamp"`
Expected: FAIL.

**Step 3: Implement**

```ts
// server/utils/date.ts
// Offline clients send when a set was actually logged / a session actually finished, as ISO.
// Invalid or missing values become null so the database default (now) applies.
export const parseClientTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : toSqliteDatetime(date)
}
```

`LogSetInput` gains `loggedAt?: string | null`. Rewrite `logSet`'s insert from
`SELECT … WHERE EXISTS (…)` to a join, so the clamp can read `started_at`:

```ts
      insertSql: `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, rpe, is_warmup, logged_at)
                  SELECT ?, ?, ?, ?, ?, ?, ?,
                         MIN(MAX(COALESCE(?, datetime('now')), ws.started_at), datetime('now'))
                  FROM exercise_logs el
                  JOIN workout_sessions ws ON ws.id = el.session_id
                  WHERE el.id = ? AND ws.status = 'in_progress'
                  RETURNING *`,
      insertArgs: [input.id, input.exerciseLogId, input.setNumber, input.weightKg, input.reps, input.rpe, input.isWarmup ? 1 : 0, input.loggedAt ?? null, input.exerciseLogId],
```

`completeSession(sessionId, expectedVersion, completedAt: string | null = null)`:

```sql
UPDATE workout_sessions
SET status = 'completed',
    completed_at = MIN(MAX(COALESCE(?, datetime('now')), started_at), datetime('now')),
    version = version + 1
WHERE id = ? AND version = ? AND status = 'in_progress'
RETURNING *
```

with args `[completedAt, sessionId, expectedVersion]`.

`SessionService.completeSession(sessionId, expectedVersion, completedAt: string | null = null)` passes it through.
Routes: `sets.post.ts` passes `loggedAt: parseClientTimestamp(body.loggedAt)`; `complete.post.ts`
passes `parseClientTimestamp(body.completedAt)`. Add both to the OpenAPI request schemas
(`{ type: 'string', format: 'date-time' }`).

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/utils/date.ts server/repositories/session.repository.ts server/services/session.service.ts "server/api/sessions/[id]/sets.post.ts" "server/api/sessions/[id]/complete.post.ts" tests/server/utils/date.test.ts tests/server/repositories/session.repository.test.ts
git commit -m "feat(sessions): accept clamped client timestamps for logged sets and completion"
```

---

### Task 2: Server — idempotent replays

**Files:**
- Modify: `server/repositories/session.repository.ts` (`editSetLog` conflict branch, `completeSession`)
- Modify: `server/services/session.service.ts` (`completeSession`)
- Tests: `tests/server/repositories/session.repository.test.ts`, `tests/server/services/session.service.test.ts`

**Step 1: Write the failing tests**

```ts
// session.repository.test.ts
describe('replay idempotency', () => {
  it('treats a replayed edit whose values already match as success, without a conflict row', async () => {
    const db = await createTestDb()
    const repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await repo.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null })

    await repo.editSetLog('a', 1, { weightKg: 62.5 })
    const replay = await repo.editSetLog('a', 1, { weightKg: 62.5 })

    expect(replay.conflict).toBe(false)
    expect((await db.execute('SELECT COUNT(*) AS n FROM sync_conflicts')).rows[0]!.n).toBe(0)
  })

  it('still reports a real conflict', async () => {
    const db = await createTestDb()
    const repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await repo.addFreeformExercise({ id: 'e1', sessionId: 's1', exerciseId: 'bench-press', position: 0, setType: 'weight_reps' })
    await repo.logSet({ id: 'a', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null })

    await repo.editSetLog('a', 1, { weightKg: 62.5 })
    expect((await repo.editSetLog('a', 1, { weightKg: 65 })).conflict).toBe(true)
  })

  it('reports an already-completed session as completed rather than conflicting', async () => {
    const db = await createTestDb()
    const repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    await repo.startSession('user-1', { id: 's1', splitDayId: null, exercises: [] })
    await repo.completeSession('s1', 1)

    const replay = await repo.completeSession('s1', 1)

    expect(replay).toMatchObject({ conflict: false, alreadyCompleted: true })
  })
})
```

In `session.service.test.ts`, replace "never calls GamificationService.onSessionCompleted when completion conflicts on a stale version" with:

```ts
  it('returns the summary without re-running gamification when the session was already completed', async () => {
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await service.completeSession('session-1', 1)
    onSessionCompleted.mockClear()

    const result = await service.completeSession('session-1', 1)

    expect(result.conflict).toBe(false)
    expect(onSessionCompleted).not.toHaveBeenCalled()
  })

  it('still conflicts for an abandoned session', async () => {
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await db.execute(`UPDATE workout_sessions SET status = 'abandoned', version = 2 WHERE id = 'session-1'`)
    expect((await service.completeSession('session-1', 1)).conflict).toBe(true)
  })
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts tests/server/services/session.service.test.ts`
Expected: FAIL.

**Step 3: Implement**

`SessionCompleteResult` gains `alreadyCompleted?: boolean`.

In `completeSession`, after `const current = await this.findSessionById(sessionId)`:

```ts
    // A replay of a completion that already applied (its response was lost offline) is success,
    // not a conflict: the caller wanted this session completed, and it is.
    if (current.status === 'completed') return { conflict: false, session: current, alreadyCompleted: true }
```

(before the `sync_conflicts` insert).

In `editSetLog`'s conflict branch, after mapping `current`:

```ts
    // A replayed edit whose response was lost arrives with the pre-edit version but values the
    // row already has. Treat it as applied rather than logging a spurious conflict.
    const alreadyApplied = keys.every((key) => {
      const k = key as keyof EditSetLogInput
      return current[k] === (corrections[k] ?? null)
    })
    if (alreadyApplied) return { conflict: false, setLog: current }
```

`SessionService.completeSession`: wrap the gamification call in
`if (!result.alreadyCompleted) { try { … } catch … }`.

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts server/services/session.service.ts tests/server/repositories/session.repository.test.ts tests/server/services/session.service.test.ts
git commit -m "feat(sessions): make replayed set edits and completions idempotent"
```

---

### Task 3: Outbox pure logic

**Files:**
- Create: `app/lib/outbox.ts`
- Create: `tests/app/lib/outbox.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/app/lib/outbox.test.ts
import { describe, expect, it } from 'vitest'
import { applyPending, backoffMs, classify, enqueue, type OutboxOp } from '~~/app/lib/outbox'
import type { WorkoutSessionWithLogs } from '~~/shared/types/session.types'

let n = 0
const base = (sessionId = 's1') => ({ opId: `op-${++n}`, sessionId, createdAt: '2026-09-14T10:00:00.000Z', attempts: 0, status: 'pending' as const, lastError: null, nextAttemptAt: 0 })
const logSet = (id: string, weightKg = 60, reps = 8): OutboxOp => ({ ...base(), kind: 'log_set', payload: { id, exerciseLogId: 'e1', setNumber: 1, weightKg, reps, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' } })
const editSet = (setLogId: string, corrections: Record<string, unknown>, expectedVersion = 1): OutboxOp => ({ ...base(), kind: 'edit_set', payload: { setLogId, expectedVersion, corrections } })
const deleteSet = (setLogId: string): OutboxOp => ({ ...base(), kind: 'delete_set', payload: { setLogId } })

const session = (): WorkoutSessionWithLogs => ({
  id: 's1', userId: 'u', splitDayId: null, status: 'in_progress', startedAt: '2026-09-14 10:00:00', completedAt: null, version: 1, format: 'straight_sets', rounds: 1,
  exercises: [{
    id: 'e1', sessionId: 's1', exerciseId: 'bench', exerciseName: 'Bench', splitExerciseId: null, position: 0, setType: 'weight_reps',
    targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRpe: null, restSeconds: null, suggestion: null,
    sets: [{ id: 'synced', exerciseLogId: 'e1', setNumber: 1, weightKg: 50, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14 10:01:00', version: 3 }],
  }],
})

describe('enqueue (compaction)', () => {
  it('folds an edit of a pending log into the log', () => {
    const ops = enqueue(enqueue([], logSet('a')), editSet('a', { reps: 10 }))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'log_set', payload: { id: 'a', reps: 10 } })
  })

  it('does not fold into a log that is already sending', () => {
    const sending = { ...logSet('a'), status: 'sending' as const }
    expect(enqueue([sending], editSet('a', { reps: 10 }))).toHaveLength(2)
  })

  it('cancels a pending log and its edits when the set is deleted', () => {
    const ops = enqueue(enqueue([logSet('keep'), logSet('a')], editSet('a', { reps: 9 })), deleteSet('a'))
    expect(ops.map(o => o.kind === 'log_set' && o.payload.id)).toEqual(['keep'])
  })

  it('keeps the delete when the log is already sending', () => {
    const ops = enqueue([{ ...logSet('a'), status: 'sending' as const }], deleteSet('a'))
    expect(ops.map(o => o.kind)).toEqual(['log_set', 'delete_set'])
  })

  it('collapses consecutive pending edits of a synced set, keeping the first expectedVersion', () => {
    const ops = enqueue(enqueue([], editSet('synced', { weightKg: 55 }, 3)), editSet('synced', { reps: 9 }, 3))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ payload: { expectedVersion: 3, corrections: { weightKg: 55, reps: 9 } } })
  })

  it('drops pending edits of a synced set that is then deleted', () => {
    const ops = enqueue(enqueue([], editSet('synced', { weightKg: 55 }, 3)), deleteSet('synced'))
    expect(ops.map(o => o.kind)).toEqual(['delete_set'])
  })
})

describe('applyPending', () => {
  it('adds pending logged sets, marked pending', () => {
    const result = applyPending(session(), [logSet('a', 60, 8)])
    const sets = result.exercises[0]!.sets
    expect(sets.map(s => s.id)).toEqual(['synced', 'a'])
    expect(sets[1]).toMatchObject({ syncState: 'pending', version: 1 })
  })

  it('does not duplicate a set the server already has', () => {
    const synced = logSet('synced')
    expect(applyPending(session(), [synced]).exercises[0]!.sets).toHaveLength(1)
  })

  it('applies edits and deletes', () => {
    expect(applyPending(session(), [editSet('synced', { reps: 12 }, 3)]).exercises[0]!.sets[0]).toMatchObject({ reps: 12, syncState: 'pending' })
    expect(applyPending(session(), [deleteSet('synced')]).exercises[0]!.sets).toHaveLength(0)
  })

  it('marks sets from failed ops as failed', () => {
    const failed = { ...logSet('a'), status: 'failed' as const }
    expect(applyPending(session(), [failed]).exercises[0]!.sets[1]!.syncState).toBe('failed')
  })

  it('ignores other sessions\' ops and applies a pending completion', () => {
    const other = { ...logSet('x'), sessionId: 's2' }
    const complete: OutboxOp = { ...base(), kind: 'complete_session', payload: { expectedVersion: 1, completedAt: '2026-09-14T11:00:00.000Z' } }
    const result = applyPending(session(), [other, complete])
    expect(result.exercises[0]!.sets).toHaveLength(1)
    expect(result.status).toBe('completed')
  })

  it('does not mutate its input', () => {
    const input = session()
    applyPending(input, [logSet('a')])
    expect(input.exercises[0]!.sets).toHaveLength(1)
  })
})

describe('classify', () => {
  it.each([
    [{ ok: true }, 'done'],
    [{ ok: false, statusCode: undefined }, 'retry'],
    [{ ok: false, statusCode: 502 }, 'retry'],
    [{ ok: false, statusCode: 401 }, 'auth'],
    [{ ok: false, statusCode: 409 }, 'conflict'],
    [{ ok: false, statusCode: 404 }, 'fail'],
    [{ ok: false, statusCode: 400 }, 'fail'],
  ] as const)('%o -> %s', (outcome, expected) => {
    expect(classify(outcome)).toBe(expected)
  })
})

describe('backoffMs', () => {
  it('doubles from 1s and caps at 60s', () => {
    expect([0, 1, 2, 5, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 32000, 60000])
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/app/lib/outbox.test.ts`
Expected: FAIL, module not found.

**Step 3: Implement**

```ts
// app/lib/outbox.ts
import type { EditSetLogInput } from '~~/server/repositories/session.repository'
import type { SetLog, WorkoutSessionWithLogs } from '~~/shared/types/session.types'

export type OutboxStatus = 'pending' | 'sending' | 'failed'

interface OpBase {
  opId: string
  sessionId: string
  createdAt: string
  attempts: number
  status: OutboxStatus
  lastError: string | null
  nextAttemptAt: number
}

export interface LogSetPayload {
  id: string
  exerciseLogId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rpe: number | null
  isWarmup: boolean
  loggedAt: string
}

export type OutboxOp =
  | OpBase & { kind: 'log_set', payload: LogSetPayload }
  | OpBase & { kind: 'edit_set', payload: { setLogId: string, expectedVersion: number, corrections: EditSetLogInput } }
  | OpBase & { kind: 'delete_set', payload: { setLogId: string } }
  | OpBase & { kind: 'complete_session', payload: { expectedVersion: number, completedAt: string } }

export type SyncedSetLog = SetLog & { syncState?: 'pending' | 'failed' }

const targetsSet = (op: OutboxOp, setLogId: string) =>
  (op.kind === 'log_set' && op.payload.id === setLogId)
  || ((op.kind === 'edit_set' || op.kind === 'delete_set') && op.payload.setLogId === setLogId)

/**
 * Appends an op, merging it into still-pending ops where the result is equivalent, so the queue
 * replays the least work. Ops already 'sending' are never merged into: their request is in
 * flight, and a merged change would be lost when the op is removed on success.
 */
export const enqueue = (ops: OutboxOp[], op: OutboxOp): OutboxOp[] => {
  const next = ops.map(o => ({ ...o, payload: { ...o.payload } }) as OutboxOp)

  if (op.kind === 'edit_set') {
    const { setLogId, corrections } = op.payload
    const pendingLog = next.find(o => o.kind === 'log_set' && o.status === 'pending' && o.payload.id === setLogId)
    if (pendingLog && pendingLog.kind === 'log_set') {
      pendingLog.payload = { ...pendingLog.payload, ...stripUndefined(corrections) }
      return next
    }
    const pendingEdit = next.find(o => o.kind === 'edit_set' && o.status === 'pending' && o.payload.setLogId === setLogId)
    if (pendingEdit && pendingEdit.kind === 'edit_set') {
      pendingEdit.payload = { ...pendingEdit.payload, corrections: { ...pendingEdit.payload.corrections, ...corrections } }
      return next
    }
  }

  if (op.kind === 'delete_set') {
    const { setLogId } = op.payload
    const hadPendingLog = next.some(o => o.kind === 'log_set' && o.status === 'pending' && o.payload.id === setLogId)
    const hasUnsentLog = next.some(o => o.kind === 'log_set' && o.status !== 'pending' && o.payload.id === setLogId)
    const kept = next.filter(o => !(o.status === 'pending' && targetsSet(o, setLogId)))
    // Deleting a set the server never received needs no request at all.
    if (hadPendingLog && !hasUnsentLog) return kept
    return [...kept, op]
  }

  return [...next, op]
}

const stripUndefined = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>

// Server state with this session's unsynced ops laid over it, so a refetch (or an offline
// snapshot) never hides what the lifter just logged.
export const applyPending = (session: WorkoutSessionWithLogs, ops: OutboxOp[]): WorkoutSessionWithLogs => {
  const result: WorkoutSessionWithLogs = {
    ...session,
    exercises: session.exercises.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s })) as SyncedSetLog[] })),
  }
  const state = (op: OutboxOp): 'pending' | 'failed' => (op.status === 'failed' ? 'failed' : 'pending')

  for (const op of ops.filter(o => o.sessionId === session.id)) {
    switch (op.kind) {
      case 'log_set': {
        const exercise = result.exercises.find(e => e.id === op.payload.exerciseLogId)
        if (!exercise || exercise.sets.some(s => s.id === op.payload.id)) break
        exercise.sets.push({ ...op.payload, version: 1, syncState: state(op) })
        exercise.sets.sort((a, b) => a.setNumber - b.setNumber)
        break
      }
      case 'edit_set': {
        for (const exercise of result.exercises) {
          const set = exercise.sets.find(s => s.id === op.payload.setLogId) as SyncedSetLog | undefined
          if (set) Object.assign(set, stripUndefined(op.payload.corrections), { syncState: state(op) })
        }
        break
      }
      case 'delete_set': {
        for (const exercise of result.exercises) exercise.sets = exercise.sets.filter(s => s.id !== op.payload.setLogId)
        break
      }
      case 'complete_session': {
        result.status = 'completed'
        break
      }
    }
  }
  return result
}

export type ReplayAction = 'done' | 'retry' | 'auth' | 'conflict' | 'fail'

export const classify = (outcome: { ok: true } | { ok: false, statusCode?: number }): ReplayAction => {
  if (outcome.ok) return 'done'
  const { statusCode } = outcome
  if (statusCode === undefined || statusCode >= 500) return 'retry'
  if (statusCode === 401) return 'auth'
  if (statusCode === 409) return 'conflict'
  return 'fail'
}

export const backoffMs = (attempts: number): number => Math.min(60_000, 1000 * 2 ** attempts)
```

**Step 4: Run to verify pass**

Run: `npx vitest run tests/app/lib/outbox.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add app/lib/outbox.ts tests/app/lib/outbox.test.ts
git commit -m "feat(offline): add outbox compaction, pending overlay and replay classification"
```

---

### Task 4: Outbox plugin (persistence + flush loop)

**Files:**
- Modify: `package.json` (via npm)
- Create: `app/lib/outbox-store.ts`
- Create: `app/plugins/outbox.client.ts`
- Create: `app/composables/useOutbox.ts`

No unit tests. The browser APIs (IndexedDB, Web Locks) are exercised manually in Task 8,
and the decision logic is already covered by Task 3.

**Step 1: Install**

```bash
npm install idb-keyval
npm install -D workbox-routing@7.4.1 workbox-strategies@7.4.1 workbox-expiration@7.4.1
```

(Match the installed `workbox-precaching` version: `node -p "require('./node_modules/workbox-precaching/package.json').version"`.)

**Step 2: Store**

```ts
// app/lib/outbox-store.ts
import { createStore, del, get, set } from 'idb-keyval'
import type { OutboxOp } from '~~/app/lib/outbox'
import type { WorkoutSessionWithLogs } from '~~/shared/types/session.types'

const store = () => createStore('hadeed', 'outbox')

export const loadOps = async (): Promise<OutboxOp[]> => (await get<OutboxOp[]>('ops', store())) ?? []
export const saveOps = (ops: OutboxOp[]) => set('ops', ops, store())
export const loadSnapshot = (sessionId: string) => get<WorkoutSessionWithLogs>(`session:${sessionId}`, store())
export const saveSnapshot = (session: WorkoutSessionWithLogs) => set(`session:${session.id}`, session, store())
export const clearOutbox = async () => {
  await del('ops', store())
}
```

**Step 3: Plugin**

```ts
// app/plugins/outbox.client.ts
import { useQueryCache } from '@pinia/colada'
import type { FetchError } from 'ofetch'
import { backoffMs, classify, enqueue, type OutboxOp } from '~~/app/lib/outbox'
import { loadOps, saveOps } from '~~/app/lib/outbox-store'
import type { SessionCompletionSummary, SetLog } from '~~/shared/types/session.types'

type NewOp = Omit<OutboxOp, 'opId' | 'createdAt' | 'attempts' | 'status' | 'lastError' | 'nextAttemptAt'>

export default defineNuxtPlugin(async () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  const ops = shallowRef<OutboxOp[]>(await loadOps())
  const online = ref(navigator.onLine)
  const syncing = ref(false)
  const paused = ref(false)                       // set on 401 until the next successful login
  const notices = ref<string[]>([])               // conflict messages for the session page
  const serverSummaries = reactive<Record<string, SessionCompletionSummary>>({})

  const persist = async (next: OutboxOp[]) => {
    ops.value = next
    await saveOps(next)
  }

  const send = async (op: OutboxOp): Promise<unknown> => {
    const base = `/api/sessions/${op.sessionId}`
    switch (op.kind) {
      case 'log_set':
        return $api<SetLog>(`${base}/sets`, { method: 'POST', body: op.payload })
      case 'edit_set':
        return $api<SetLog>(`${base}/sets/${op.payload.setLogId}`, { method: 'PATCH', body: { expectedVersion: op.payload.expectedVersion, ...op.payload.corrections } })
      case 'delete_set':
        return $api(`${base}/sets/${op.payload.setLogId}`, { method: 'DELETE' })
      case 'complete_session':
        return $api<{ summary: SessionCompletionSummary }>(`${base}/complete`, { method: 'POST', body: op.payload })
    }
  }

  const invalidateSession = (sessionId: string) => Promise.all([
    queryCache.invalidateQueries({ key: queryKeys.session(sessionId) }),
    queryCache.invalidateQueries({ key: queryKeys.home() }),
    queryCache.invalidateQueries({ key: queryKeys.workouts() }),
  ])

  // The earliest op not yet sent, skipping any session whose queue is blocked by a failed op
  // (later ops for it would only fail the same way until the user retries or discards).
  const nextDue = (list: OutboxOp[]) => {
    const blocked = new Set(list.filter(o => o.status === 'failed').map(o => o.sessionId))
    return list.find(o => o.status === 'pending' && !blocked.has(o.sessionId) && o.nextAttemptAt <= Date.now())
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), ms)
  }

  const flush = async () => {
    if (syncing.value || paused.value) return
    syncing.value = true
    try {
      await navigator.locks.request('hadeed-outbox', async () => {
        ops.value = await loadOps() // another tab may have flushed
        for (let op = nextDue(ops.value); op; op = nextDue(ops.value)) {
          const current = op
          await persist(ops.value.map(o => (o.opId === current.opId ? { ...o, status: 'sending' } : o)))
          try {
            const response = await send(current)
            let remaining = ops.value.filter(o => o.opId !== current.opId)
            if (current.kind === 'edit_set') {
              // Later edits to the same set were queued against the pre-edit version.
              const version = (response as SetLog).version
              remaining = remaining.map(o => (o.kind === 'edit_set' && o.payload.setLogId === current.payload.setLogId
                ? { ...o, payload: { ...o.payload, expectedVersion: version } }
                : o))
            }
            if (current.kind === 'complete_session') serverSummaries[current.sessionId] = (response as { summary: SessionCompletionSummary }).summary
            await persist(remaining)
            if (!remaining.some(o => o.sessionId === current.sessionId)) await invalidateSession(current.sessionId)
          } catch (err) {
            const statusCode = (err as FetchError).response ? (err as FetchError).statusCode : undefined
            const action = classify({ ok: false, statusCode })
            const without = ops.value.filter(o => o.opId !== current.opId)
            if (action === 'retry' || action === 'auth') {
              await persist(ops.value.map(o => (o.opId === current.opId
                ? { ...o, status: 'pending', attempts: o.attempts + 1, nextAttemptAt: Date.now() + backoffMs(o.attempts) }
                : o)))
              if (action === 'auth') paused.value = true
              else schedule(backoffMs(current.attempts))
              break
            }
            if (action === 'conflict' && current.kind === 'edit_set') {
              notices.value = [...notices.value, 'A set was changed on another device — your offline edit wasn\'t applied.']
              await persist(without)
              await invalidateSession(current.sessionId)
              continue
            }
            if (current.kind === 'delete_set' && statusCode === 404) {
              await persist(without) // already gone
              continue
            }
            await persist(ops.value.map(o => (o.opId === current.opId
              ? { ...o, status: 'failed', lastError: (err as FetchError).data?.statusMessage ?? `HTTP ${statusCode}` }
              : o)))
          }
        }
      })
    } finally {
      syncing.value = false
      if (ops.value.some(o => o.status === 'pending')) schedule(30_000)
    }
  }

  const add = async (op: NewOp) => {
    const full = { ...op, opId: crypto.randomUUID(), createdAt: new Date().toISOString(), attempts: 0, status: 'pending', lastError: null, nextAttemptAt: 0 } as OutboxOp
    await persist(enqueue(ops.value, full))
    void flush()
  }

  const retry = async (opId: string) => {
    paused.value = false
    await persist(ops.value.map(o => (o.opId === opId ? { ...o, status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null } : o)))
    void flush()
  }

  const discard = async (opId: string) => {
    const op = ops.value.find(o => o.opId === opId)
    await persist(ops.value.filter(o => o.opId !== opId))
    if (op) await invalidateSession(op.sessionId)
  }

  const resume = () => {
    paused.value = false
    void flush()
  }

  window.addEventListener('online', () => { online.value = true; void flush() })
  window.addEventListener('offline', () => { online.value = false })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void flush() })
  void flush()

  return { provide: { outbox: { ops, online, syncing, paused, notices, serverSummaries, add, retry, discard, resume, flush } } }
})
```

```ts
// app/composables/useOutbox.ts
// Client-only: the outbox plugin isn't registered during SSR, where there is nothing to queue.
export const useOutbox = () => {
  const { $outbox } = useNuxtApp()
  return $outbox
}
```

**Step 4: Verify it compiles**

Run: `npx nuxi typecheck`
Expected: no new errors. If `$outbox` is untyped, add an `app/types/outbox.d.ts` augmenting
`NuxtApp` with `$outbox: ReturnType<…>`, or rely on Nuxt's plugin type inference.

**Step 5: Commit**

```bash
git add package.json package-lock.json app/lib/outbox-store.ts app/plugins/outbox.client.ts app/composables/useOutbox.ts
git commit -m "feat(offline): add an IndexedDB outbox that replays session writes in order"
```

---

### Task 5: Route session mutations and reads through the outbox

**Files:**
- Modify: `app/composables/useLogSet.ts`, `useEditSetLog.ts`, `useDeleteSetLog.ts`, `useCompleteSession.ts`, `useSession.ts`

**Step 1: `useLogSet`**

```ts
export const useLogSet = () => {
  const outbox = useOutbox()
  return useMutation<SetLog, LogSetPayload>({
    // The id is generated here, before queueing, so a replay after a lost response hits the
    // server's idempotent insert instead of creating a duplicate set.
    mutation: async ({ sessionId, ...input }) => {
      const payload = { ...input, id: crypto.randomUUID(), loggedAt: new Date().toISOString() }
      await outbox.add({ kind: 'log_set', sessionId, payload })
      return { ...payload, version: 1 } as SetLog
    },
  })
}
```

**Step 2: `useEditSetLog`**

```ts
    mutation: async ({ sessionId, setLogId, expectedVersion, ...corrections }) => {
      await outbox.add({ kind: 'edit_set', sessionId, payload: { setLogId, expectedVersion, corrections } })
      return { success: true }
    },
```

(Change the mutation's result type to `{ success: boolean }`; the page ignores it.)

**Step 3: `useDeleteSetLog`**: `outbox.add({ kind: 'delete_set', sessionId, payload: { setLogId } })`.

**Step 4: `useCompleteSession`**

```ts
    mutation: async ({ sessionId, expectedVersion }) => {
      await outbox.add({ kind: 'complete_session', sessionId, payload: { expectedVersion, completedAt: new Date().toISOString() } })
      return { queued: true as const }
    },
```

Remove all `onSuccess` invalidations from these four. The plugin invalidates once a
session's queue drains.

**Step 5: `useSession`**

```ts
export const useSession = (id: MaybeRefOrGetter<string>) => {
  const { $api } = useNuxtApp()
  const outbox = import.meta.client ? useOutbox() : null
  const snapshot = shallowRef<WorkoutSessionWithLogs | null>(null)

  const query = useQuery<WorkoutSessionWithLogs, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.session(toValue(id)),
    query: async () => {
      const session = await $api<WorkoutSessionWithLogs>(`/api/sessions/${toValue(id)}`)
      if (import.meta.client) void saveSnapshot(session)
      return session
    },
    enabled: () => toValue(id) !== '',
  })

  if (import.meta.client) {
    watch(() => toValue(id), async (sessionId) => {
      snapshot.value = sessionId ? (await loadSnapshot(sessionId)) ?? null : null
    }, { immediate: true })
  }

  // Server data (or the last offline snapshot when the fetch failed) with unsynced ops on top.
  const data = computed(() => {
    const baseSession = query.data.value ?? snapshot.value
    if (!baseSession) return undefined
    return outbox ? applyPending(baseSession, outbox.ops.value) : baseSession
  })

  return { ...query, data }
}
```

Import `applyPending` from `~~/app/lib/outbox` and `loadSnapshot` / `saveSnapshot` from
`~~/app/lib/outbox-store`.

**Step 6: Verify**

Run: `npx nuxi typecheck`. Expected: errors only in `app/pages/workouts/session/[id].vue`
(`completeSession` result shape and the 409 handling), fixed in Task 7.

**Step 7: Commit**

```bash
git add app/composables/useLogSet.ts app/composables/useEditSetLog.ts app/composables/useDeleteSetLog.ts app/composables/useCompleteSession.ts app/composables/useSession.ts
git commit -m "feat(offline): queue session writes and overlay pending ops on the session query"
```

---

### Task 6: Service worker caching, auth middleware, logout cleanup

**Files:**
- Modify: `app/sw.ts`
- Create: `app/lib/last-user.ts`
- Modify: `app/middleware/auth.global.ts`
- Modify: `app/pages/profile.vue` (sign-out handler)

**Step 1: `app/sw.ts`**. Add after `precacheAndRoute(self.__WB_MANIFEST)`:

```ts
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// Offline session logging (docs/plans/2026-09-14-offline-session-logging-design.md): pages the
// user has visited, and the GET reads the session page needs, fall back to cache when the
// network is slow or gone. Writes are never routed here; the outbox owns them. Both caches hold
// per-user data and are deleted on sign-out.
registerRoute(new NavigationRoute(new NetworkFirst({
  cacheName: 'pages',
  networkTimeoutSeconds: 3,
  plugins: [new ExpirationPlugin({ maxEntries: 20 })],
})))

const OFFLINE_READS = [/^\/api\/sessions\/[^/]+$/, /^\/api\/exercises\//, /^\/api\/profile$/, /^\/api\/auth\/me$/]

registerRoute(
  ({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && OFFLINE_READS.some(re => re.test(url.pathname)),
  new NetworkFirst({
    cacheName: 'api-reads',
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  }),
)
```

(`/api/auth/me` is cached so client-side navigation between cached pages works. The
middleware fix below covers the uncached case.)

**Step 2: `app/lib/last-user.ts`**

```ts
// A "was signed in on this device" marker, so a navigation made with no network isn't mistaken
// for a signed-out user. Only a real 401 from /api/auth/me clears it.
const KEY = 'hadeed:last-user'

export const rememberUser = (userId: string | null) => {
  try {
    if (userId) localStorage.setItem(KEY, userId)
    else localStorage.removeItem(KEY)
  } catch {}
}

export const lastKnownUser = (): string | null => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
```

**Step 3: middleware**. Replace the fetch chain:

```ts
    const userId = await requestFetch<{ userId: string | null }>('/api/auth/me')
      .then((me) => {
        if (import.meta.client) rememberUser(me.userId)
        return me.userId
      })
      .catch((err: FetchError) => {
        // No response at all means offline, not signed out.
        if (import.meta.client && !err.response) return lastKnownUser()
        if (import.meta.client) rememberUser(null)
        return null
      })
```

**Step 4: sign-out** (`profile.vue`, the handler that calls `logout()`):

```ts
  const outbox = useOutbox()
  const unsynced = outbox.ops.value.length
  if (unsynced > 0 && !confirm(`You have ${unsynced} workout change${unsynced === 1 ? '' : 's'} that haven't synced. Sign out and lose them?`)) return
  await logout()
  rememberUser(null)
  await clearOutbox()
  await Promise.all(['pages', 'api-reads'].map(name => caches.delete(name)))
```

Keep the existing navigation after logout.

**Step 5: Commit**

```bash
git add app/sw.ts app/lib/last-user.ts app/middleware/auth.global.ts app/pages/profile.vue
git commit -m "feat(offline): cache session reads in the service worker and keep offline users signed in"
```

---

### Task 7: Session page sync status and offline finish

**Files:**
- Create: `app/components/session/SyncStatus.vue`
- Modify: `app/pages/workouts/session/[id].vue`

**Step 1: `SyncStatus.vue`**

```vue
<script setup lang="ts">
const props = defineProps<{ sessionId: string }>()
const outbox = useOutbox()

const sessionOps = computed(() => outbox.ops.value.filter(o => o.sessionId === props.sessionId))
const pending = computed(() => sessionOps.value.filter(o => o.status !== 'failed'))
const failed = computed(() => sessionOps.value.filter(o => o.status === 'failed'))
const drawerOpen = ref(false)

const label = computed(() => {
  if (failed.value.length) return `${failed.value.length} change${failed.value.length === 1 ? '' : 's'} couldn't sync`
  if (!pending.value.length) return null
  if (outbox.paused.value) return 'Sign in again to sync'
  if (!outbox.online.value) return `Offline · ${pending.value.length} pending`
  return 'Syncing…'
})

const describe = (op: (typeof sessionOps.value)[number]) => {
  switch (op.kind) {
    case 'log_set': return `Set ${op.payload.setNumber}: ${op.payload.weightKg ?? '–'}kg × ${op.payload.reps ?? '–'}`
    case 'edit_set': return 'Edit to a set'
    case 'delete_set': return 'Deleted set'
    case 'complete_session': return 'Finish workout'
  }
}
</script>

<template>
  <button
    v-if="label"
    type="button"
    class="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[1px]"
    :class="failed.length ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'"
    @click="failed.length && (drawerOpen = true)"
  >
    {{ label }}
  </button>

  <UiDrawer v-model:open="drawerOpen">
    <UiDrawerContent class="space-y-3 p-4">
      <p class="font-heading text-lg">Changes that couldn't sync</p>
      <div v-for="op in failed" :key="op.opId" class="flex items-center justify-between gap-2 text-sm">
        <div class="min-w-0">
          <p class="truncate text-foreground">{{ describe(op) }}</p>
          <p class="truncate text-xs text-muted-foreground">{{ op.lastError }}</p>
        </div>
        <div class="flex shrink-0 gap-2">
          <UiButton size="sm" variant="secondary" @click="outbox.retry(op.opId)">Retry</UiButton>
          <UiButton size="sm" variant="ghost" @click="outbox.discard(op.opId)">Discard</UiButton>
        </div>
      </div>
    </UiDrawerContent>
  </UiDrawer>
</template>
```

(Check the drawer component names in `app/components/ui/drawer/index.ts` and match them. If
the project imports `Button` from `@/components/ui/button` rather than `UiButton`, follow that.)

**Step 2: Session page**

- Render `<SessionSyncStatus :session-id="sessionId" />` next to the Finish button.
- Under the header, show conflict notices and a dismiss:

```vue
<p v-for="(notice, i) in outbox.notices.value" :key="i" class="text-sm text-muted-foreground">
  {{ notice }} <button class="underline" @click="outbox.notices.value = outbox.notices.value.filter((_, j) => j !== i)">OK</button>
</p>
```

- Dim pending sets and flag failed ones in the set row: `:class="{ 'opacity-60': set.syncState === 'pending', 'text-destructive': set.syncState === 'failed' }"`.
- Delete the 409 branches in `saveEdit` and `finish`. Conflicts are handled by the outbox now.
  Keep a generic catch for IndexedDB failures ("Couldn't save that change on this device.").
- **Finish.** Replace the completion flow:

```ts
const outbox = useOutbox()
const finishedLocally = ref(false)

// Shown immediately on Finish, online or not; replaced by the server's summary (PRs, streak)
// as soon as the queued completion syncs.
const localSummary = computed<SessionCompletionSummary | null>(() => {
  if (!finishedLocally.value || !session.value) return null
  const startedAt = new Date(`${session.value.startedAt.replace(' ', 'T')}Z`)
  const totalVolumeKg = session.value.exercises
    .flatMap(e => e.sets)
    .filter(s => !s.isWarmup)
    .reduce((sum, s) => sum + (s.weightKg ?? 0) * (s.reps ?? 0), 0)
  return {
    totalVolumeKg,
    durationMinutes: Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 60000)),
    prsHit: [],
    currentStreak: 0,
  }
})
const completionSummary = computed(() => outbox.serverSummaries[sessionId.value] ?? localSummary.value)
const summaryPending = computed(() => !outbox.serverSummaries[sessionId.value])

const finish = async () => {
  if (!session.value) return
  const hasSkippedExercises = session.value.exercises.some(exercise => exercise.sets.length === 0)
  if (hasSkippedExercises && !confirm('Some exercises have no logged sets. Finish anyway?')) return
  finishError.value = null
  try {
    await completeSession.mutateAsync({ sessionId: sessionId.value, expectedVersion: session.value.version })
    finishedLocally.value = true
  } catch {
    finishError.value = "Couldn't save that on this device. Please try again."
  }
}
```

Remove the old `completionSummary = ref(...)`. In the summary template, when `summaryPending`,
render the Streak and PRs cards' values as "—" with a caption "Available once synced", and
hide the PR list and the "Next time" card from the progression plan.

**Step 3: Commit**

```bash
git add app/components/session/SyncStatus.vue "app/pages/workouts/session/[id].vue"
git commit -m "feat(offline): show sync status on the session page and finish workouts offline"
```

---

### Task 8: Manual offline verification

`npm run build && npm run preview`. The production SW is more faithful than the dev SW.
Sign in, start today's workout, then:

1. **Offline logging.** DevTools Network → Offline. Log three sets. They appear dimmed and
   the pill reads "Offline · 3 pending". Reload the page: it loads from cache with all three
   sets still visible.
2. **Edit/delete while offline.** Edit set 2's reps and delete set 3. The pill shows 2 pending
   (the compacted queue). Check DevTools → Application → IndexedDB → `hadeed/outbox/ops`.
3. **Navigate offline.** Go to `/workouts` and back. You are not redirected to `/login`.
4. **Finish offline.** Tap Finish. The summary shows volume and duration, with PRs/streak
   "Available once synced".
5. **Reconnect.** Network → Online. The pill disappears within a few seconds, the summary
   swaps to server values, and Home shows the session completed with a plausible duration
   (not inflated by the offline gap).
6. **Conflict.** In two tabs, edit the same synced set to different values, one while
   offline; reconnect. The offline tab shows the "changed on another device" notice and ends
   up with the server's value.
7. **Failure.** Offline, log a set; in the database set that session to
   `status = 'abandoned'`; reconnect. The pill shows "1 change couldn't sync", and Discard
   removes it.
8. **Sign-out.** With an op pending, Sign out → confirm prompt. After confirming,
   `caches.keys()` in the console no longer lists `pages` / `api-reads`.

Record any failures as bugs against the relevant task before moving on.

---

### Task 9: Final verification

1. `npx vitest run`: all pass.
2. `npx nuxi typecheck`: no new errors.
3. `npx eslint .`: clean.
4. README "Workout logging → Offline-ready writes": rewrite as "Offline session logging —
   sets, edits, deletes and finishing a workout queue in IndexedDB and replay in order when
   back online; the session page and its reads are cached by the service worker."
5. `git add README.md && git commit -m "docs: describe offline session logging"`.

---

### Task 10: Re-detect PRs for sets that arrive out of order (done)

**Not part of the offline build.** Surfaced while implementing Task 2, and it is a gap in
Task 1's client-timestamp feature rather than in the outbox.

**The problem.** A set delivered for the first time with a client `loggedAt` older than sets
already stored — an offline session syncing after a later workout already landed from another
device — gets the *right* PR verdict itself: `findWorkingSetsBefore` orders by
`(logged_at, rowid)` and picks up its true predecessors. But the sets that came after it keep
PRs they should no longer hold, because nothing re-evaluates them against a baseline that just
gained a member.

This is **not** a replay problem. `SessionRepository.logSet` goes through `insertIdempotent`,
which returns the existing row without rewriting it, so a replayed set never moves in the
ordering and its reward path re-runs against an identical baseline.

**Shipped** in `bc62d8e`, behind one shared helper with plan 1's Task 16 — both are "a
set's PR verdict went stale because the baseline around it changed".
`SessionService.rewardPastSession`'s sweep was extracted as
`redetectLaterPersonalRecords(exerciseId, setLogId)` and is now called from `rewardPastSession`,
`editSet` and `logSet` alike.

**Keeping it off the hot path.** `logSet` runs on every set mid-workout, so it only probes for
later sets when one could exist. Three checks that cost nothing rule the probe out first:

- a replay stored no new row (`SessionRepository.logSet` now reports `alreadyLogged` the way
  `editSetLog` reports `alreadyApplied`), so the first delivery already swept
- a warm-up is filtered out of every PR baseline, so it changes no other set's verdict
- with no client `loggedAt` the row is stamped `datetime('now')` and takes the highest rowid,
  and nothing can be stored above now, so it sorts last by construction

Past those, the probe is `findWorkingSetsAfter` itself: any cheaper test needs the same indexed
lookup, and reusing it means a genuinely backdated set doesn't pay for it twice. The exercise id
is resolved once per call and passed into `recordPersonalRecords`, so the sweep adds no lookup
of its own. The app's own client always sends `loggedAt`, so in practice an ordinary set costs
one extra query that comes back empty.
