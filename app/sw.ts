import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

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
