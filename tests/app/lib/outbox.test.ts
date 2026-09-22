import { describe, expect, it } from 'vitest'
import { applyPending, backoffMs, classify, compact, enqueue, type OutboxOp } from '~~/app/lib/outbox'
import type { WorkoutSessionWithLogs } from '~~/shared/types/session.types'

let n = 0
const base = (sessionId = 's1') => ({ opId: `op-${++n}`, sessionId, createdAt: '2026-09-14T10:00:00.000Z', attempts: 0, status: 'pending' as const, lastError: null, nextAttemptAt: 0 })
const logSet = (id: string, weightKg = 60, reps = 8, setNumber = 1): OutboxOp => ({ ...base(), kind: 'log_set', payload: { id, exerciseLogId: 'e1', setNumber, weightKg, reps, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' } })
const editSet = (setLogId: string, corrections: Record<string, unknown>, expectedVersion = 1): OutboxOp => ({ ...base(), kind: 'edit_set', payload: { setLogId, expectedVersion, corrections } })
const deleteSet = (setLogId: string): OutboxOp => ({ ...base(), kind: 'delete_set', payload: { setLogId } })

const session = (): WorkoutSessionWithLogs => ({
  id: 's1', userId: 'u', splitDayId: null, status: 'in_progress', startedAt: '2026-09-14 10:00:00', completedAt: null, version: 1, format: 'straight_sets', rounds: 1, loggedRetroactively: false,
  exercises: [{
    id: 'e1', sessionId: 's1', exerciseId: 'bench', exerciseName: 'Bench', splitExerciseId: null, position: 0, setType: 'weight_reps',
    targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRpe: null, restSeconds: null, suggestion: null,
    sets: [{ id: 'synced', exerciseLogId: 'e1', setNumber: 2, weightKg: 50, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14 10:01:00', version: 3 }],
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

  it('lets the later correction win when the two edits touch the same field', () => {
    const ops = enqueue(enqueue([], editSet('synced', { reps: 9 }, 3)), editSet('synced', { reps: 12 }, 3))
    expect(ops[0]).toMatchObject({ payload: { expectedVersion: 3, corrections: { reps: 12 } } })
  })

  it('does not collapse into an edit that is already sending', () => {
    const sending = { ...editSet('synced', { weightKg: 55 }, 3), status: 'sending' as const }
    expect(enqueue([sending], editSet('synced', { reps: 9 }, 4))).toHaveLength(2)
  })

  it('drops pending edits of a synced set that is then deleted', () => {
    const ops = enqueue(enqueue([], editSet('synced', { weightKg: 55 }, 3)), deleteSet('synced'))
    expect(ops.map(o => o.kind)).toEqual(['delete_set'])
  })

  it('leaves ops for other sets untouched and keeps their order', () => {
    const ops = enqueue(enqueue([logSet('a'), editSet('synced', { reps: 9 }, 3)], logSet('b')), editSet('b', { reps: 7 }))
    expect(ops.map(o => o.kind)).toEqual(['log_set', 'edit_set', 'log_set'])
    expect(ops[2]).toMatchObject({ payload: { id: 'b', reps: 7 } })
  })

  it('does not mutate the ops it was given', () => {
    const existing = [logSet('a')]
    const snapshot = structuredClone(existing)
    enqueue(existing, editSet('a', { reps: 10 }))
    expect(existing).toEqual(snapshot)
  })
})

describe('compact', () => {
  it('compacts an empty list to an empty list', () => {
    expect(compact([])).toEqual([])
  })

  it('is idempotent', () => {
    const ops = [
      logSet('a'),
      { ...logSet('b'), status: 'sending' as const },
      editSet('b', { reps: 11 }),
      logSet('c'),
      editSet('c', { weightKg: 70 }),
      deleteSet('c'),
      editSet('synced', { rpe: 8 }, 3),
      editSet('synced', { reps: 9 }, 3),
    ]
    const once = compact(ops)
    // The pending log/edit/delete trio for 'c' cancels out entirely; 'b' survives because its
    // log is in flight; the two 'synced' edits merge.
    expect(once.map(o => o.kind)).toEqual(['log_set', 'log_set', 'edit_set', 'edit_set'])
    expect(compact(once)).toEqual(once)
  })
})

describe('applyPending', () => {
  it('adds pending logged sets, marked pending', () => {
    const result = applyPending(session(), [logSet('a', 60, 8, 3)])
    const sets = result.exercises[0]!.sets
    expect(sets.map(s => s.id)).toEqual(['synced', 'a'])
    expect(sets[1]).toMatchObject({ syncState: 'pending', version: 1 })
  })

  it('orders pending sets by set number rather than by arrival', () => {
    const result = applyPending(session(), [logSet('warmup', 20, 12, 1)])
    expect(result.exercises[0]!.sets.map(s => s.id)).toEqual(['warmup', 'synced'])
  })

  it('does not duplicate a set the server already has', () => {
    const synced = logSet('synced')
    expect(applyPending(session(), [synced]).exercises[0]!.sets).toHaveLength(1)
  })

  it('applies edits and deletes', () => {
    expect(applyPending(session(), [editSet('synced', { reps: 12 }, 3)]).exercises[0]!.sets[0]).toMatchObject({ reps: 12, syncState: 'pending' })
    expect(applyPending(session(), [deleteSet('synced')]).exercises[0]!.sets).toHaveLength(0)
  })

  it('ignores corrections that are explicitly undefined', () => {
    const result = applyPending(session(), [editSet('synced', { reps: undefined, weightKg: 62.5 }, 3)])
    expect(result.exercises[0]!.sets[0]).toMatchObject({ reps: 8, weightKg: 62.5 })
  })

  it('edits and deletes a set that is itself still pending', () => {
    const sending = { ...logSet('a', 60, 8, 3), status: 'sending' as const }
    const edited = applyPending(session(), [sending, editSet('a', { reps: 10 })])
    expect(edited.exercises[0]!.sets[1]).toMatchObject({ id: 'a', reps: 10, syncState: 'pending' })
    const deleted = applyPending(session(), [sending, deleteSet('a')])
    expect(deleted.exercises[0]!.sets.map(s => s.id)).toEqual(['synced'])
  })

  it('ignores an edit or delete of a set nobody has', () => {
    const result = applyPending(session(), [editSet('ghost', { reps: 99 }, 1), deleteSet('ghost')])
    expect(result.exercises[0]!.sets).toEqual(session().exercises[0]!.sets)
  })

  it('drops a pending log whose exercise is not in the session', () => {
    const orphan: OutboxOp = { ...base(), kind: 'log_set', payload: { id: 'a', exerciseLogId: 'gone', setNumber: 1, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' } }
    expect(applyPending(session(), [orphan]).exercises[0]!.sets).toHaveLength(1)
  })

  it('marks sets from failed ops as failed', () => {
    const failed = { ...logSet('a', 60, 8, 3), status: 'failed' as const }
    expect(applyPending(session(), [failed]).exercises[0]!.sets[1]!.syncState).toBe('failed')
  })

  it('ignores other sessions\' ops and applies a pending completion', () => {
    const other = { ...logSet('x'), sessionId: 's2' }
    const complete: OutboxOp = { ...base(), kind: 'complete_session', payload: { expectedVersion: 1, completedAt: '2026-09-14T11:00:00.000Z' } }
    const result = applyPending(session(), [other, complete])
    expect(result.exercises[0]!.sets).toHaveLength(1)
    expect(result.status).toBe('completed')
  })

  it('returns the session unchanged when there is nothing pending', () => {
    expect(applyPending(session(), [])).toEqual(session())
  })

  it('does not mutate its input', () => {
    const input = session()
    applyPending(input, [logSet('a'), editSet('synced', { reps: 12 }, 3)])
    expect(input).toEqual(session())
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
