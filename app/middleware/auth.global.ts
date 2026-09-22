import { lastKnownUser, rememberUser, resolveAuthFailure } from '~~/app/lib/last-user'

const PUBLIC_PATHS = new Set(['/login', '/onboarding'])

const AUTH_CHECK_TTL_MS = 30_000

export default defineNuxtRouteMiddleware(async (to, from) => {
  const requestFetch = useRequestFetch()
  const cached = useState<{ userId: string | null, checkedAt: number } | null>('auth-check', () => null)

  const crossingPublicBoundary = PUBLIC_PATHS.has(to.path) || PUBLIC_PATHS.has(from.path)
  const isFresh = cached.value && !crossingPublicBoundary && Date.now() - cached.value.checkedAt < AUTH_CHECK_TTL_MS

  if (!isFresh) {
    const userId = await requestFetch<{ userId: string | null }>('/api/auth/me')
      .then((me) => {
        // A 200 is the only authoritative "there is no session" this endpoint gives -- it answers
        // `{ userId: null }` rather than 401 -- so it is the one place outside sign-out that is
        // allowed to drop the marker.
        if (import.meta.client && me.userId === null) rememberUser(null)
        return me.userId
      })
      .catch((error: unknown) => {
        // Offline, this request fails with no response at all, and mapping that to "signed out"
        // is what redirected a lifter to /login the first time the cache above expired
        // mid-workout. The marker written on every answered check tells the two apart; see
        // app/lib/last-user.ts for which failures are allowed to clear it.
        if (!import.meta.client) return null
        const { userId: fallback, forget } = resolveAuthFailure(error, lastKnownUser())
        if (forget) rememberUser(null)
        return fallback
      })
    cached.value = { userId, checkedAt: Date.now() }
  }

  // Written on every client navigation rather than only on a fresh check: the first check of a
  // visit runs during SSR and reaches the client as payload, so a phone that lost signal before
  // that 30s cache expired would otherwise have no marker to fall back on at all.
  if (import.meta.client && cached.value!.userId) rememberUser(cached.value!.userId)

  const isAuthenticated = cached.value!.userId != null

  if (!isAuthenticated && !PUBLIC_PATHS.has(to.path)) {
    return navigateTo('/login')
  }
  if (isAuthenticated && PUBLIC_PATHS.has(to.path)) {
    return navigateTo('/')
  }
})
