import type { EditSetLogInput } from "~~/server/repositories/session.repository"
import type { ExerciseLog, SetLog, WorkoutSessionWithLogs } from "~~/shared/types/session.types"

// 'sending' is set by the flush loop (Task 4) for the op whose request is in flight. It matters
// here because an op the server may already have seen can no longer be rewritten or dropped.
export type OutboxStatus = "pending" | "sending" | "failed"

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
  // Generated before enqueueing, so replaying the op inserts the same row rather than a duplicate.
  id: string
  exerciseLogId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rpe: number | null
  isWarmup: boolean
  // When the set was actually performed, not when it synced. The server clamps it to the
  // session window, so a workout finished offline records its real duration.
  loggedAt: string
}

export type OutboxOp =
  | (OpBase & { kind: "log_set", payload: LogSetPayload })
  | (OpBase & { kind: "edit_set", payload: { setLogId: string, expectedVersion: number, corrections: EditSetLogInput } })
  | (OpBase & { kind: "delete_set", payload: { setLogId: string } })
  | (OpBase & { kind: "complete_session", payload: { expectedVersion: number, completedAt: string } })

// A set the server hasn't confirmed yet. `syncState` is absent on every set that came back from
// the server, so the UI can tell "logged" from "logged, still in the queue" without a second list.
export type SyncedSetLog = SetLog & { syncState?: "pending" | "failed" }

export type SessionWithPending = Omit<WorkoutSessionWithLogs, "exercises"> & {
  exercises: (ExerciseLog & { sets: SyncedSetLog[] })[]
}

// `EditSetLogInput`'s fields are all optional, and a form that leaves one blank sends it as
// `undefined`. Merging that in as-is would blank out a value the user never touched.
const stripUndefined = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>

const targetsSet = (op: OutboxOp, setLogId: string) =>
  (op.kind === "log_set" && op.payload.id === setLogId)
  || ((op.kind === "edit_set" || op.kind === "delete_set") && op.payload.setLogId === setLogId)

/**
 * Appends an op, merging it into still-pending ops where the result is equivalent, so the queue
 * replays the least work -- a lifter who corrects the same set five times offline syncs one set,
 * not six requests. Ops already 'sending' are never merged into: their request is in flight, and
 * a merged change would be lost when the op is removed on success.
 */
export const enqueue = (ops: OutboxOp[], op: OutboxOp): OutboxOp[] => {
  const next = ops.map(o => ({ ...o, payload: { ...o.payload } }) as OutboxOp)

  if (op.kind === "edit_set") {
    const { setLogId, corrections } = op.payload
    // The server has never seen this set, so its "original" is whatever we send. Folding the
    // correction in is exact, not a guess.
    const pendingLog = next.find(o => o.kind === "log_set" && o.status === "pending" && o.payload.id === setLogId)
    if (pendingLog && pendingLog.kind === "log_set") {
      pendingLog.payload = { ...pendingLog.payload, ...stripUndefined(corrections) }
      return next
    }
    // Two unsent edits of a synced set: last write wins per field, and `expectedVersion` stays
    // the *first* one's. Both were made against the same unsynced local view, so they carry the
    // same base version anyway -- but keeping the first is the one that provably names a row the
    // server actually holds. The second's is only a prediction of where the row would land had
    // the first been sent, and if the first had been sent it would no longer be pending here.
    const pendingEdit = next.find(o => o.kind === "edit_set" && o.status === "pending" && o.payload.setLogId === setLogId)
    if (pendingEdit && pendingEdit.kind === "edit_set") {
      pendingEdit.payload = { ...pendingEdit.payload, corrections: { ...pendingEdit.payload.corrections, ...corrections } }
      return next
    }
  }

  if (op.kind === "delete_set") {
    const { setLogId } = op.payload
    const hadPendingLog = next.some(o => o.kind === "log_set" && o.status === "pending" && o.payload.id === setLogId)
    const hasUnsentLog = next.some(o => o.kind === "log_set" && o.status !== "pending" && o.payload.id === setLogId)
    // Edits of a set that is about to be deleted are dead work whether or not the set is synced.
    const kept = next.filter(o => !(o.status === "pending" && targetsSet(o, setLogId)))
    // Deleting a set the server never received needs no request at all. If the insert is already
    // in flight (or failed mid-flight) the row may exist, so the delete still has to go out.
    if (hadPendingLog && !hasUnsentLog) return kept
    return [...kept, op]
  }

  return [...next, op]
}

// The whole queue folded through `enqueue`. Order-preserving and idempotent: compacting an
// already-compacted list leaves it alone, because nothing foldable survives the first pass.
export const compact = (ops: OutboxOp[]): OutboxOp[] => ops.reduce<OutboxOp[]>(enqueue, [])

/**
 * Server state with this session's unsynced ops laid over it, so a refetch (or an offline
 * snapshot) never hides what the lifter just logged. Pure: the input session is left alone, since
 * it is the query cache's own object.
 */
export const applyPending = (session: WorkoutSessionWithLogs, ops: OutboxOp[]): SessionWithPending => {
  const result: SessionWithPending = {
    ...session,
    exercises: session.exercises.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s }) as SyncedSetLog) })),
  }
  const state = (op: OutboxOp): "pending" | "failed" => (op.status === "failed" ? "failed" : "pending")

  for (const op of ops.filter(o => o.sessionId === session.id)) {
    switch (op.kind) {
      case "log_set": {
        const exercise = result.exercises.find(e => e.id === op.payload.exerciseLogId)
        // Already-present means the op synced but hasn't been dequeued yet -- show it once.
        if (!exercise || exercise.sets.some(s => s.id === op.payload.id)) break
        exercise.sets.push({ ...op.payload, version: 1, syncState: state(op) })
        exercise.sets.sort((a, b) => a.setNumber - b.setNumber)
        break
      }
      case "edit_set": {
        for (const exercise of result.exercises) {
          const set = exercise.sets.find(s => s.id === op.payload.setLogId)
          // Edits can land on a set that is itself still pending (its log op is in flight), which
          // is why this runs over the overlaid list rather than the server's.
          if (set) Object.assign(set, stripUndefined(op.payload.corrections), { syncState: state(op) })
        }
        break
      }
      case "delete_set": {
        for (const exercise of result.exercises) exercise.sets = exercise.sets.filter(s => s.id !== op.payload.setLogId)
        break
      }
      case "complete_session": {
        // completedAt is deliberately left as the server has it: the op's timestamp is an ISO
        // string, the column is SQLite datetime, and the offline summary reads the op directly.
        result.status = "completed"
        break
      }
    }
  }
  return result
}

export type ReplayAction = "done" | "retry" | "auth" | "conflict" | "fail"

// No status code means the request never got a response (offline, DNS, dropped connection) --
// exactly the case the outbox exists for, so it retries rather than failing.
export const classify = (outcome: { ok: true } | { ok: false, statusCode?: number }): ReplayAction => {
  if (outcome.ok) return "done"
  const { statusCode } = outcome
  if (statusCode === undefined || statusCode >= 500) return "retry"
  if (statusCode === 401) return "auth"
  if (statusCode === 409) return "conflict"
  return "fail"
}

// 1s, 2s, 4s ... capped at a minute. No jitter: one queue per tab, serialised by a web lock, so
// there is no thundering herd to spread out -- and a deterministic delay is testable.
export const backoffMs = (attempts: number): number => Math.min(60_000, 1000 * 2 ** attempts)
