import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

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
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.ico',
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
