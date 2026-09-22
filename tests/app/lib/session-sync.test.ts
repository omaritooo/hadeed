import { describe, expect, it } from 'vitest'
import type { OutboxOp } from '~~/app/lib/outbox'
import { describeOp, localCompletionSummary, opStatusLine, sessionTotals, syncStatusFor } from '~~/app/lib/session-sync'

let n = 0
const base = (sessionId = 's1') => ({ opId: `op-${++n}`, sessionId, createdAt: '2026-09-14T10:00:00.000Z', attempts: 0, status: 'pending' as const, lastError: null, nextAttemptAt: 0 })

const logSet = (over: Partial<OutboxOp> = {}, payload: Record<string, unknown> = {}): OutboxOp => ({
  ...base(),
  kind: 'log_set',
  payload: { id: 'set-1', exerciseLogId: 'e1', setNumber: 3, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z', ...payload },
  ...over,
} as OutboxOp)

const editSet = (corrections: Record<string, unknown> = { reps: 9 }, over: Partial<OutboxOp> = {}): OutboxOp =>
  ({ ...base(), kind: 'edit_set', payload: { setLogId: 'set-1', expectedVersion: 2, corrections }, ...over } as OutboxOp)

const deleteSet = (): OutboxOp => ({ ...base(), kind: 'delete_set', payload: { setLogId: 'set-1' } } as OutboxOp)
const completion = (over: Partial<OutboxOp> = {}): OutboxOp =>
  ({ ...base(), kind: 'complete_session', payload: { expectedVersion: 4, completedAt: '2026-09-14T11:02:00.000Z' }, ...over } as OutboxOp)

const online = { online: true, paused: false }
const offline = { online: false, paused: false }

describe('syncStatusFor', () => {
  it('says nothing when the session has nothing queued', () => {
    expect(syncStatusFor([], 's1', online)).toBeNull()
  })

  it('ignores another session\'s queue', () => {
    expect(syncStatusFor([logSet({ sessionId: 's2' })], 's1', offline)).toBeNull()
  })

  it('counts everything still queued while offline', () => {
    const status = syncStatusFor([logSet(), logSet(), completion()], 's1', offline)
    expect(status).toMatchObject({ tone: 'offline', label: 'Offline · 3 pending' })
  })

  it('reports an in-flight queue as syncing', () => {
    expect(syncStatusFor([logSet({ status: 'sending' })], 's1', online)?.label).toBe('Syncing…')
  })

  it('reports offline ahead of a paused queue, since a login needs signal too', () => {
    const status = syncStatusFor([logSet()], 's1', { online: false, paused: true })
    expect(status).toMatchObject({ tone: 'offline', label: 'Offline · 1 pending' })
  })

  it('asks for a sign-in once there is signal to sign in with', () => {
    expect(syncStatusFor([logSet()], 's1', { online: true, paused: true })?.label).toBe('Sign in again to sync')
  })

  it('reports failures ahead of everything else, singular and plural', () => {
    expect(syncStatusFor([logSet({ status: 'failed' })], 's1', offline)?.label).toBe("1 change couldn't sync")
    const two = syncStatusFor([logSet({ status: 'failed' }), editSet({ reps: 9 }, { status: 'failed' }), completion()], 's1', online)
    expect(two).toMatchObject({ tone: 'failed', label: "2 changes couldn't sync" })
    expect(two?.failed).toHaveLength(2)
    expect(two?.queued).toHaveLength(3)
  })

  it('carries drawer copy for every tone', () => {
    const tones = [
      syncStatusFor([logSet()], 's1', offline),
      syncStatusFor([logSet()], 's1', online),
      syncStatusFor([logSet()], 's1', { online: true, paused: true }),
      syncStatusFor([logSet({ status: 'failed' })], 's1', online),
    ]
    expect(tones.map(status => status?.tone)).toEqual(['offline', 'syncing', 'paused', 'failed'])
    for (const status of tones) {
      expect(status?.title).toBeTruthy()
      expect(status?.blurb).toBeTruthy()
    }
  })
})

describe('describeOp', () => {
  it('names a logged set by number and load', () => {
    expect(describeOp(logSet(), 'metric')).toBe('Set 3 · 60kg × 8')
  })

  it('renders the load in the reader\'s unit rather than the kg the op stores', () => {
    expect(describeOp(logSet({}, { weightKg: 102.0582 }), 'imperial')).toBe('Set 3 · 225lb × 8')
  })

  it('describes a bodyweight set by its reps instead of a missing weight', () => {
    expect(describeOp(logSet({}, { weightKg: null }), 'metric')).toBe('Set 3 · 8 reps')
  })

  it('falls back to the set number when neither value was filled in', () => {
    expect(describeOp(logSet({}, { weightKg: null, reps: null }), 'metric')).toBe('Set 3')
  })

  it('describes an edit by its corrected values', () => {
    expect(describeOp(editSet({ weightKg: 62.5, reps: 8 }), 'metric')).toBe('Set correction · 62.5kg × 8')
  })

  it('describes an edit that touched neither weight nor reps', () => {
    expect(describeOp(editSet({ isWarmup: true }), 'metric')).toBe('Set correction')
  })

  it('names deletes and completions', () => {
    expect(describeOp(deleteSet(), 'metric')).toBe('Deleted set')
    expect(describeOp(completion(), 'metric')).toBe('Finish workout')
  })
})

describe('opStatusLine', () => {
  it('prefers the server\'s own reason for a failure', () => {
    expect(opStatusLine(logSet({ status: 'failed', lastError: 'Session is no longer in progress' }))).toBe('Session is no longer in progress')
  })

  it('still says something when a failure carries no reason', () => {
    expect(opStatusLine(logSet({ status: 'failed' }))).toBe("Couldn't sync")
  })

  it('distinguishes an op in flight from one waiting its turn', () => {
    expect(opStatusLine(logSet({ status: 'sending' }))).toBe('Sending…')
    expect(opStatusLine(logSet())).toBe('Waiting to sync')
  })
})

const session = (sets: { weightKg: number | null, reps: number | null, isWarmup: boolean }[][], startedAt = '2026-09-14 10:00:00') => ({
  startedAt,
  exercises: sets.map(exerciseSets => ({ sets: exerciseSets })),
})

describe('sessionTotals', () => {
  it('sums volume over working sets only', () => {
    const totals = sessionTotals(session([[
      { weightKg: 20, reps: 10, isWarmup: true },
      { weightKg: 60, reps: 8, isWarmup: false },
      { weightKg: 60, reps: 7, isWarmup: false },
    ]]))
    expect(totals).toEqual({ workingSets: 2, exercisesTrained: 1, totalVolumeKg: 900 })
  })

  it('contributes nothing for a set missing a weight or reps, as the server does', () => {
    expect(sessionTotals(session([[
      { weightKg: null, reps: 12, isWarmup: false },
      { weightKg: 40, reps: null, isWarmup: false },
    ]])).totalVolumeKg).toBe(0)
  })

  it('counts only exercises that were actually trained', () => {
    const totals = sessionTotals(session([[{ weightKg: 60, reps: 8, isWarmup: false }], []]))
    expect(totals).toMatchObject({ exercisesTrained: 1, workingSets: 1 })
  })
})

describe('localCompletionSummary', () => {
  const startedAtMs = Date.UTC(2026, 8, 14, 10, 0, 0)

  it('measures the duration to the moment Finish was tapped, reading started_at as UTC', () => {
    const summary = localCompletionSummary(session([[{ weightKg: 60, reps: 8, isWarmup: false }]]), startedAtMs + 62 * 60_000)
    expect(summary).toEqual({ totalVolumeKg: 480, durationMinutes: 62, prsHit: [], currentStreak: 0 })
  })

  it('never reports a negative duration when the phone clock is behind the session start', () => {
    expect(localCompletionSummary(session([[]]), startedAtMs - 60_000).durationMinutes).toBe(0)
  })

  it('falls back to zero rather than NaN on an unreadable started_at', () => {
    expect(localCompletionSummary(session([[]], 'not a date'), startedAtMs).durationMinutes).toBe(0)
  })

  it('leaves PRs and the streak empty rather than guessing them offline', () => {
    const summary = localCompletionSummary(session([[{ weightKg: 100, reps: 5, isWarmup: false }]]), startedAtMs)
    expect(summary.prsHit).toEqual([])
    expect(summary.currentStreak).toBe(0)
  })
})
