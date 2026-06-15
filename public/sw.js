/* global self, clients */

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { body: event.data.text() }
  }

  // Payloads follow the Mastodon Web Push shape: { title, body, icon, url, … }.
  // `icon` is the sender's avatar; fall back to the app icon when absent.
  const title = data.title || 'Activities'
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/notifications' }
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(
    event.notification.data?.url || '/notifications',
    self.location.origin
  ).href

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus()
          }
        }
        return clients.openWindow(url)
      })
  )
})
