const PUBLIC_PATHS = new Set(['/login', '/onboarding'])

export default defineNuxtRouteMiddleware(async (to) => {
  const requestFetch = useRequestFetch()

  const isAuthenticated = await requestFetch<{ userId: string | null }>('/api/auth/me')
    .then(me => me.userId != null)
    .catch(() => false)

  if (!isAuthenticated && !PUBLIC_PATHS.has(to.path)) {
    return navigateTo('/login')
  }
  if (isAuthenticated && PUBLIC_PATHS.has(to.path)) {
    return navigateTo('/')
  }
})
