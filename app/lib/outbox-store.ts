import type { UseStore } from "idb-keyval"
import type { OutboxOp, OutboxStatus } from "~~/app/lib/outbox"
import type { WorkoutSessionWithLogs } from "~~/shared/types/session.types"
import { clear, createStore, get, set } from "idb-keyval"

const OPS_KEY = "ops"

// `createStore` opens a database connection per call and the outbox touches the store on every
// op, so the connection is made once, lazily -- importing this module must not open IndexedDB
// (it is imported during SSR type resolution and in tests, where there is no indexedDB at all).
let connection: UseStore | undefined
const store = () => (connection ??= createStore("hadeed", "outbox"))

// 2 ** 40 ms is already past the 60s cap by orders of magnitude, so every count above this
// behaves identically -- the cap only exists to keep the arithmetic finite.
const MAX_ATTEMPTS = 40

const KINDS = new Set(["log_set", "edit_set", "delete_set", "complete_session"])
const STATUSES = new Set<unknown>(["pending", "sending", "failed"] satisfies OutboxStatus[])

/**
 * `attempts` is read back from disk, where it can be whatever a corrupt write, an interrupted
 * upgrade or an older build left behind. `backoffMs` trusts its argument: a negative count gives
 * a sub-second delay (every phone that has one hammering the server), and `NaN` gives `NaN`,
 * which as a `setTimeout` delay means "fire immediately", forever. Clamping here -- at the one
 * boundary where an untrusted value enters -- lets the rest of the outbox treat it as a count.
 */
export const clampAttempts = (attempts: unknown): number => {
  const value = typeof attempts === "number" ? attempts : Number(attempts)
  // NaN compares false against every bound, so it has to be handled before clamping; it means
  // "we have no idea how many times this ran", which is closest to none. An infinite count does
  // clamp, and lands on the 60s cap -- the cautious end, not the hammer-the-server end.
  if (Number.isNaN(value)) return 0
  return Math.min(MAX_ATTEMPTS, Math.max(0, Math.trunc(value)))
}

const isOpShape = (value: unknown): value is OutboxOp => {
  if (typeof value !== "object" || value === null) return false
  const op = value as Partial<OutboxOp>
  return typeof op.opId === "string"
    && typeof op.sessionId === "string"
    && typeof op.kind === "string" && KINDS.has(op.kind)
    && typeof op.payload === "object" && op.payload !== null
}

/**
 * Everything read out of IndexedDB passes through here. An op missing the fields needed to send
 * it can never succeed and would block its session's queue forever, so it is dropped; the
 * bookkeeping fields are repaired rather than dropped, because the op itself is still a set the
 * lifter logged.
 */
export const sanitizeOps = (value: unknown): OutboxOp[] => {
  if (!Array.isArray(value)) return []
  return value.filter(isOpShape).map(op => ({
    ...op,
    attempts: clampAttempts(op.attempts),
    // A non-finite `nextAttemptAt` compares false against every clock reading, which would park
    // the op forever. 0 means "due now", which is what a freshly enqueued op carries anyway.
    nextAttemptAt: Number.isFinite(op.nextAttemptAt) ? op.nextAttemptAt : 0,
    // A 'sending' status is kept deliberately: it marks an op whose request may have reached the
    // server before the tab died, which `enqueue` must keep refusing to merge into.
    status: STATUSES.has(op.status) ? op.status : "pending",
    lastError: typeof op.lastError === "string" ? op.lastError : null,
  } as OutboxOp))
}

export const loadOps = async (): Promise<OutboxOp[]> => sanitizeOps(await get<unknown>(OPS_KEY, store()))

export const saveOps = async (ops: OutboxOp[]): Promise<void> => {
  await set(OPS_KEY, ops, store())
}

// The last server response for a session, so the page can render a workout that was opened
// offline (see `applyPending`, which lays the queue back over it).
export const loadSnapshot = (sessionId: string): Promise<WorkoutSessionWithLogs | undefined> =>
  get<WorkoutSessionWithLogs>(`session:${sessionId}`, store())

export const saveSnapshot = async (session: WorkoutSessionWithLogs): Promise<void> => {
  await set(`session:${session.id}`, session, store())
}

/**
 * Sign-out. Everything this store holds belongs to the account that wrote it: the queue, and the
 * session snapshots `useSession` falls back to whenever the query has no data -- which is exactly
 * a session the next account on the phone cannot fetch, so deleting only the queue would leave
 * the previous user's workout to render for them (`loadSnapshot` is keyed by session id, not by
 * user). The whole object store goes rather than a sweep of `session:` keys, so a key added here
 * later is covered without anyone remembering to add it.
 */
export const clearOutbox = async (): Promise<void> => {
  await clear(store())
}
