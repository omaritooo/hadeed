import type { PastSessionInput } from '~~/shared/types/session.types'

export const PAST_SESSION_MAX_DAYS = 14

const DAY_MS = 86_400_000
// The form limits dates by the lifter's local calendar, and the server only sees UTC, so the
// server floor allows one extra day rather than rejecting a valid "14 days ago" east of UTC.
const SERVER_FLOOR_MS = (PAST_SESSION_MAX_DAYS + 1) * DAY_MS
// A client clock a little ahead of the server's shouldn't make "today" read as the future.
const FUTURE_SLACK_MS = 5 * 60_000

// Returns a user-facing reason, or null when the input is valid.
export const validatePastSession = (input: PastSessionInput, now: Date): string | null => {
  const startedAt = new Date(input.startedAt)
  if (Number.isNaN(startedAt.getTime())) return 'startedAt must be a valid date'
  if (startedAt.getTime() > now.getTime() + FUTURE_SLACK_MS) return 'A past workout cannot be in the future'
  if (startedAt.getTime() < now.getTime() - SERVER_FLOOR_MS) return `A past workout can be at most ${PAST_SESSION_MAX_DAYS} days old`
  if (input.exercises.length === 0) return 'Add at least one exercise'

  for (const exercise of input.exercises) {
    if (!Number.isInteger(exercise.sets) || exercise.sets < 1) return 'Every exercise needs at least one set'
    if (exercise.setType === 'time') continue
    if (exercise.reps === null || exercise.reps < 1) return 'Every exercise needs reps'
    if (exercise.setType === 'weight_reps' && (exercise.weightKg === null || exercise.weightKg < 0)) return 'Every weighted exercise needs a weight'
  }
  return null
}

// Synthetic, strictly increasing timestamps: PR detection and history order sets by
// (logged_at, rowid), so a backfilled workout must keep its sets in form order and sit entirely
// before anything logged later. The start is pulled back when needed so no set lands after `now`.
export const pastSessionTimestamps = (requestedStart: Date, setCount: number, now: Date) => {
  const latestStart = now.getTime() - (setCount + 1) * 1000
  const start = new Date(Math.min(requestedStart.getTime(), latestStart))
  start.setUTCMilliseconds(0)
  const at = (offsetSeconds: number) => new Date(start.getTime() + offsetSeconds * 1000)
  return {
    startedAt: start,
    setTimes: Array.from({ length: setCount }, (_, i) => at(i + 1)),
    completedAt: at(setCount + 1),
  }
}
