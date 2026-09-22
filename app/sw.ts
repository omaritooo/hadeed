import type { WorkboxPlugin } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

// A new build takes over as soon as it installs rather than waiting for every window of the app
// to close; the client (registerType 'autoUpdate') then reloads onto it.
self.addEventListener('install', () => {
  void self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Offline session logging (docs/plans/2026-09-14-offline-session-logging-design.md). A basement
// gym with no signal is the normal case here, not the edge one, so a page the lifter has already
// opened -- and the GET reads that page needs -- come back from cache when the network is slow or
// gone. Writes are never routed through the service worker: workbox only registers routes for
// GET, so a POST or a PATCH falls straight through to the network, and the outbox stays the one
// thing that decides when a set is sent and in what order.
//
// Both caches below hold one account's data. They are deleted on sign-out, in
// app/composables/useLogout.ts -- a second account on the same phone must not be able to open the
// previous one's workout.

const NETWORK_TIMEOUT_SECONDS = 3

/**
 * Workbox caches any 200 by default, a redirected one included. A navigation cannot be *served* a
 * redirected response -- the browser rejects it as a network error -- and this app redirects on
 * navigation whenever the auth or onboarding middleware runs during SSR, so caching one would
 * break the very page this cache exists to keep working. Declaring `cacheWillUpdate` replaces
 * workbox's own status check rather than adding to it, so the 200 test is repeated here.
 */
const skipRedirects: WorkboxPlugin = {
  cacheWillUpdate: async ({ response }) => (response.status === 200 && !response.redirected ? response : null),
}

registerRoute(new NavigationRoute(new NetworkFirst({
  cacheName: 'pages',
  networkTimeoutSeconds: NETWORK_TIMEOUT_SECONDS,
  // A workout is logged over a handful of pages; 20 covers the session, the workouts list and
  // home with room to spare, and caps what one account leaves on the phone.
  plugins: [skipRedirects, new ExpirationPlugin({ maxEntries: 20 })],
})))

// Everything the session page reads: the session itself, the exercises it names (`by-ids`, the
// detail route and its history), and the profile for units. Anchored so the writes underneath a
// session (`/sets`, `/complete`) cannot match.
//
// Deliberately *not* `/api/auth/me`. It answers 200 with a null userId when signed out, so it is
// cacheable, and NetworkFirst serves the cached identity whenever the network misses the timeout
// -- which on a slow-but-working connection bounces a signed-out lifter off /login as though they
// were still signed in. The `hadeed:last-user` marker already covers the offline case the route
// middleware needs, so caching this buys nothing and costs that.
const OFFLINE_READS = [/^\/api\/sessions\/[^/]+$/, /^\/api\/exercises\//, /^\/api\/profile$/]

registerRoute(
  ({ url, request }) => request.method === 'GET'
    && url.origin === self.location.origin
    && OFFLINE_READS.some(pattern => pattern.test(url.pathname)),
  new NetworkFirst({
    cacheName: 'api-reads',
    networkTimeoutSeconds: NETWORK_TIMEOUT_SECONDS,
    // A week is longer than any workout, and far shorter than the life of an install: a read that
    // has not been refreshed in that long is stale enough to be worth a spinner.
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  }),
)

interface PushPayload {
  title: string
  body: string
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = { title: 'Hadeed', body: 'Time to hydrate.' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // A payload that isn't JSON still shows the default hydration reminder.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      tag: 'hydration-reminder',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(client => 'focus' in client)
      if (existing) return existing.focus()
      return self.clients.openWindow('/')
    }),
  )
})
