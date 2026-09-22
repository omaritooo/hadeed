import { describe, expect, it } from 'vitest'
import { backoffMs } from '~~/app/lib/outbox'
import { clampAttempts, sanitizeOps } from '~~/app/lib/outbox-store'

const storedOp = (overrides: Record<string, unknown> = {}) => ({
  opId: 'op-1',
  sessionId: 's1',
  kind: 'log_set',
  payload: { id: 'set-1', exerciseLogId: 'e1', setNumber: 1, weightKg: 60, reps: 8, rpe: null, isWarmup: false, loggedAt: '2026-09-14T10:00:00.000Z' },
  createdAt: '2026-09-14T10:00:00.000Z',
  attempts: 0,
  status: 'pending',
  lastError: null,
  nextAttemptAt: 0,
  ...overrides,
})

describe('clampAttempts', () => {
  it('floors a negative count at zero, so backoff never drops below a second', () => {
    expect(clampAttempts(-5)).toBe(0)
    expect(backoffMs(clampAttempts(-5))).toBe(1000)
  })

  it('turns a non-numeric count into zero rather than a NaN delay', () => {
    expect(clampAttempts(Number.NaN)).toBe(0)
    expect(clampAttempts(undefined)).toBe(0)
    expect(clampAttempts(null)).toBe(0)
    expect(clampAttempts('nope')).toBe(0)
    expect(backoffMs(clampAttempts(Number.NaN))).toBe(1000)
  })

  it('caps an absurd count so 2 ** attempts stays finite', () => {
    expect(clampAttempts(Number.POSITIVE_INFINITY)).toBe(40)
    expect(clampAttempts(1e9)).toBe(40)
    expect(backoffMs(clampAttempts(1e9))).toBe(60_000)
  })

  it('reads a numeric string and truncates a fractional count', () => {
    expect(clampAttempts('2')).toBe(2)
    expect(clampAttempts(3.7)).toBe(3)
  })
})

describe('sanitizeOps', () => {
  it('returns an empty queue for anything that is not an array', () => {
    expect(sanitizeOps(undefined)).toEqual([])
    expect(sanitizeOps(null)).toEqual([])
    expect(sanitizeOps({ ops: [] })).toEqual([])
  })

  it('drops entries that could never be sent', () => {
    const ops = sanitizeOps([
      storedOp(),
      storedOp({ opId: undefined }),
      storedOp({ kind: 'drop_database' }),
      storedOp({ payload: null }),
      'garbage',
      null,
    ])
    expect(ops).toHaveLength(1)
    expect(ops[0]!.opId).toBe('op-1')
  })

  it('clamps attempts read back from disk', () => {
    const [op] = sanitizeOps([storedOp({ attempts: -3 })])
    expect(op!.attempts).toBe(0)
  })

  it('makes a non-finite nextAttemptAt due immediately instead of never', () => {
    const [op] = sanitizeOps([storedOp({ nextAttemptAt: Number.NaN })])
    // NaN <= now is false for every now, which would park the op forever.
    expect(op!.nextAttemptAt).toBe(0)
  })

  it('keeps a sending status, so a crashed op is still off-limits to compaction', () => {
    const [op] = sanitizeOps([storedOp({ status: 'sending' })])
    expect(op!.status).toBe('sending')
  })

  it('falls back to pending for an unrecognised status', () => {
    const [op] = sanitizeOps([storedOp({ status: 'wat' })])
    expect(op!.status).toBe('pending')
  })

  it('normalises a non-string lastError', () => {
    const [op] = sanitizeOps([storedOp({ lastError: { message: 'boom' } })])
    expect(op!.lastError).toBeNull()
  })
})
