import type { FetchError } from "ofetch"

/**
 * The "was signed in on this device" marker, and the policy for when it stands in for an answer
 * from `/api/auth/me`.
 *
 * Offline, that request fails with no response at all, which the route middleware used to map to
 * "signed out" -- so the first navigation after the 30s auth cache expired bounced a lifter to
 * /login, mid-workout, in a gym with no signal. The marker is what tells the two apart: this
 * device had a session and nobody has signed out of it since.
 */
const KEY = "hadeed:last-user"

/**
 * Safari's private mode throws on write and a locked-down browser can throw on read. Neither is
 * worth failing a navigation over: no marker only means the offline fallback is unavailable, and
 * the app falls back to what it did before -- treating the failure as signed out.
 */
export const rememberUser = (userId: string | null): void => {
  try {
    if (userId) localStorage.setItem(KEY, userId)
    else localStorage.removeItem(KEY)
  }
  catch {
    // Storage is unavailable. The marker is a hint, never the source of truth.
  }
}

export const lastKnownUser = (): string | null => {
  try {
    return localStorage.getItem(KEY)
  }
  catch {
    return null
  }
}

/** What the app does with a `/api/auth/me` that did not come back as an answer. */
export interface AuthFailureOutcome {
  /** The id to carry on with -- null redirects to /login. */
  userId: string | null
  /** Whether this failure is proof the session is gone, and the marker should go with it. */
  forget: boolean
}

/**
 * `/api/auth/me` answers `200 { userId: null }` when there is no session (see
 * server/api/auth/me.get.ts), so "signed out" arrives as a *success*, never as a status here.
 * Everything that reaches this function is trouble getting to the answer, and ofetch only sets
 * `response` when a server actually replied -- no response means offline.
 *
 * The distinction worth making is the third one: a 500, or a 502 from a proxy, is not a sign-out.
 * Clearing the marker on it would leave the *next* navigation -- made offline, moments later --
 * with nothing to fall back on, which is the bug this marker exists to fix. So only an answer
 * that says "not you" forgets the user; everything else keeps them and lets the navigation
 * through. That is safe because the middleware is UX: every endpoint holding data still checks
 * the session server-side, so a user let through with no session sees errors, not someone else's
 * training.
 */
export const resolveAuthFailure = (error: unknown, marker: string | null): AuthFailureOutcome => {
  const failure = error as FetchError | undefined
  const statusCode = failure?.response ? failure.statusCode : undefined
  if (statusCode === 401 || statusCode === 403) return { userId: null, forget: true }
  return { userId: marker, forget: false }
}
