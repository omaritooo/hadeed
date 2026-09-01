const PUBLIC_PATHS = new Set(['/login', '/onboarding'])

const AUTH_CHECK_TTL_MS = 30_000

export default defineNuxtRouteMiddleware(async (to, from) => {
  const requestFetch = useRequestFetch()
  const cached = useState<{ userId: string | null, checkedAt: number } | null>('auth-check', () => null)

  const crossingPublicBoundary = PUBLIC_PATHS.has(to.path) || PUBLIC_PATHS.has(from.path)
  const isFresh = cached.value && !crossingPublicBoundary && Date.now() - cached.value.checkedAt < AUTH_CHECK_TTL_MS

  if (!isFresh) {
    const userId = await requestFetch<{ userId: string | null }>('/api/auth/me')
      .then(me => me.userId)
      .catch(() => null)
    cached.value = { userId, checkedAt: Date.now() }
  }

  const isAuthenticated = cached.value!.userId != null

  if (!isAuthenticated && !PUBLIC_PATHS.has(to.path)) {
    return navigateTo('/login')
  }
  if (isAuthenticated && PUBLIC_PATHS.has(to.path)) {
    return navigateTo('/')
  }
})
