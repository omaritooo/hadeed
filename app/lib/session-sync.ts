import type { OutboxOp } from "~~/app/lib/outbox"
import type { UnitSystem } from "~~/shared/lib/progression"
import type { SessionCompletionSummary } from "~~/shared/types/session.types"
import { formatLoad } from "~~/shared/lib/suggestion-copy"

/**
 * What the session's queue is telling the lifter. The tone drives the colour, and only 'failed'
 * is a problem: in the gyms this app is used in, offline is the expected state of the phone for
 * most of the workout, not an error to alarm anyone about.
 */
export type SyncTone = "offline" | "syncing" | "paused" | "failed"

export interface SyncStatus {
  tone: SyncTone
  /** The pill's one line. */
  label: string
  /** The drawer's heading and the sentence under it. */
  title: string
  blurb: string
  /** Every unsent op for this session, in queue order. */
  queued: OutboxOp[]
  /** The subset needing a decision -- the only ops that get Retry / Discard. */
  failed: OutboxOp[]
}

const plural = (count: number, singular: string) => `${count} ${singular}${count === 1 ? "" : "s"}`

const COPY: Record<SyncTone, { title: string, blurb: string }> = {
  failed: {
    title: "Changes that couldn't sync",
    blurb: "These need a decision. Retry sends them again; Discard drops them from this phone for good.",
  },
  offline: {
    title: "Waiting to sync",
    blurb: "Saved on this phone. They go up on their own the moment you have signal again.",
  },
  paused: {
    title: "Waiting to sync",
    blurb: "Saved on this phone. Sign in again and they go up on their own.",
  },
  syncing: {
    title: "Syncing",
    blurb: "Sending these to your account now.",
  },
}

/**
 * The session's queue as one line, or `null` when there is nothing worth saying -- which is the
 * state a connected workout is in for all but a second at a time, and the pill renders nothing at
 * all there.
 *
 * Offline is reported ahead of a paused (signed-out) queue deliberately. "Sign in again" sends a
 * lifter with no signal to a login screen that cannot answer them; "Offline" is the reason they
 * can actually act on, and the 401 that paused the queue is still waiting when signal returns.
 */
export const syncStatusFor = (
  ops: OutboxOp[],
  sessionId: string,
  connection: { online: boolean, paused: boolean },
): SyncStatus | null => {
  const queued = ops.filter(op => op.sessionId === sessionId)
  if (queued.length === 0) return null
  const failed = queued.filter(op => op.status === "failed")

  const tone: SyncTone = failed.length > 0
    ? "failed"
    : !connection.online
        ? "offline"
        : connection.paused ? "paused" : "syncing"

  const label = tone === "failed"
    ? `${plural(failed.length, "change")} couldn't sync`
    : tone === "offline"
      ? `Offline · ${queued.length} pending`
      : tone === "paused" ? "Sign in again to sync" : "Syncing…"

  return { tone, label, ...COPY[tone], queued, failed }
}

const setValues = (weightKg: number | null | undefined, reps: number | null | undefined, unitSystem: UnitSystem) => {
  const load = typeof weightKg === "number" ? formatLoad(weightKg, unitSystem) : null
  if (load !== null && typeof reps === "number") return `${load} × ${reps}`
  if (load !== null) return load
  // A set with reps and no load is a real set (bodyweight work), not a half-filled one, so it
  // gets a description of its own rather than a dash where the weight would be.
  if (typeof reps === "number") return `${reps} reps`
  return null
}

/**
 * One queued change, named the way the lifter logged it. The load is rendered in the profile's
 * unit rather than the kg the op stores: a drawer offering to discard "60kg × 8" to someone who
 * typed 135lb is describing a set they do not recognise.
 */
export const describeOp = (op: OutboxOp, unitSystem: UnitSystem): string => {
  switch (op.kind) {
    case "log_set": {
      const values = setValues(op.payload.weightKg, op.payload.reps, unitSystem)
      return values === null ? `Set ${op.payload.setNumber}` : `Set ${op.payload.setNumber} · ${values}`
    }
    case "edit_set": {
      // The op carries the set's id, not its number: the set it corrects may itself still be
      // queued, so there is no server row to read a number off, and a guessed one would name the
      // wrong set in the one place the lifter is deciding what to throw away.
      const values = setValues(op.payload.corrections.weightKg, op.payload.corrections.reps, unitSystem)
      return values === null ? "Set correction" : `Set correction · ${values}`
    }
    case "delete_set":
      return "Deleted set"
    case "complete_session":
      return "Finish workout"
  }
}

/** The second line under each op in the drawer: why it is still here. */
export const opStatusLine = (op: OutboxOp): string => {
  if (op.status === "failed") return op.lastError ?? "Couldn't sync"
  if (op.status === "sending") return "Sending…"
  return "Waiting to sync"
}

// SQLite hands back datetimes as "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker, which every
// browser is free to read as local time. The swap to ISO with an explicit Z is what makes the
// duration below agree with the server's.
export const sessionStartedAtMs = (startedAt: string): number => new Date(`${startedAt.replace(" ", "T")}Z`).getTime()

/** The shape both the server's session and the pending-overlaid one satisfy. */
interface LoggedSession {
  startedAt: string
  exercises: { sets: { weightKg: number | null, reps: number | null, isWarmup: boolean }[] }[]
}

export interface SessionTotals {
  /** Warm-ups excluded, matching every other volume and set count in the app. */
  workingSets: number
  exercisesTrained: number
  totalVolumeKg: number
}

export const sessionTotals = (session: LoggedSession): SessionTotals => {
  const working = session.exercises.flatMap(exercise => exercise.sets).filter(set => !set.isWarmup)
  return {
    workingSets: working.length,
    exercisesTrained: session.exercises.filter(exercise => exercise.sets.length > 0).length,
    // Deliberately the same arithmetic as the server's SUM(weight_kg * reps) over non-warm-up
    // rows: a set missing either value contributes nothing there, and `?? 0` is how that reads
    // here. The two numbers have to match, or the volume visibly jumps when the summary syncs.
    totalVolumeKg: working.reduce((sum, set) => sum + (set.weightKg ?? 0) * (set.reps ?? 0), 0),
  }
}

/**
 * The summary shown the instant Finish is tapped, computed from what is already on the phone, so
 * a workout finished in a basement ends on a real number rather than a spinner.
 *
 * `finishedAtMs` is the moment Finish was tapped -- the same instant stamped on the queued
 * completion op -- not "now", so the duration does not creep upward while the page sits open and
 * does not shift when the server's summary replaces this one.
 *
 * PRs and the streak are left empty rather than guessed: both need training history this phone
 * does not hold, and a wrong streak is worse than an honest "available once synced".
 */
export const localCompletionSummary = (session: LoggedSession, finishedAtMs: number): SessionCompletionSummary => {
  const startedAtMs = sessionStartedAtMs(session.startedAt)
  // An unparseable started_at gives NaN, which would render as "NaN min" on the one screen that
  // is meant to feel like a reward. Zero is wrong too, but it is quietly wrong.
  const elapsedMs = Number.isFinite(startedAtMs) ? finishedAtMs - startedAtMs : 0
  return {
    totalVolumeKg: sessionTotals(session).totalVolumeKg,
    durationMinutes: Math.max(0, Math.round(elapsedMs / 60000)),
    prsHit: [],
    currentStreak: 0,
  }
}
