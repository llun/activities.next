/* global self, clients */

self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()
  const title = data.title || 'Activities'
  const options = {
    body: data.body || '',
    icon: '/activities/icon-192.png',
    badge: '/activities/icon-192.png',
    data: { url: data.url || '/notifications' }
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/notifications'

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus()
          }
        }
        return clients.openWindow(url)
      })
  )
})
