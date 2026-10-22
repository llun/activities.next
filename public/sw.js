/* global self, clients, caches, indexedDB, Response, Request */

const sw = typeof self !== 'undefined' ? self : globalThis
const getClients = () => (typeof clients !== 'undefined' ? clients : sw.clients)

const MEDIA_CACHE_NAME = 'activities-media-v1'
const MAX_MEDIA_ENTRIES = 150
const SHELL_CACHE_PREFIX = 'activities-shell-'
const OFFLINE_DB_NAME = 'activities_offline_v1'

const SVG_PLACEHOLDER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" fill="none"><rect width="100" height="100" fill="#e2e8f0"/><path d="M35 45a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM25 70h50L60 50 48 65l-8-10-15 15Z" fill="#94a3b8"/></svg>'

function getSvgPlaceholderResponse() {
  return new Response(SVG_PLACEHOLDER, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store'
    }
  })
}

// Static and `no-store`: it holds no personal data and is never cached.
function offlinePageResponse() {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not saved for offline</title><style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#fff;color:#0f172a}main{max-width:28rem}a{color:#c2410c;margin-right:16px}@media (prefers-color-scheme:dark){body{background:#0f172a;color:#f1f5f9}a{color:#fdba74}}</style></head><body><main><h1>Not saved for offline</h1><p>This page wasn\'t saved on this device. Connect to the internet to open it.</p><p><a href="/drafts">Drafts</a><a href="/">Home</a></p></main></body></html>'
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}

const RESERVED_STATIC_DIRS = new Set([
  'chunks',
  'css',
  'media',
  'development',
  'webpack'
])

function hashString(str) {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

function extractBuildId(html) {
  const manifestMatch = html.match(
    /(?:\/activities)?\/_next\/static\/([a-zA-Z0-9_-]+)\/(?:_buildManifest|_ssgManifest)/
  )
  if (manifestMatch) return manifestMatch[1]

  const jsonMatch = html.match(/"buildId":"([^"]+)"/)
  if (jsonMatch) return jsonMatch[1]

  const segmentMatches = html.matchAll(
    /(?:\/activities)?\/_next\/static\/([a-zA-Z0-9_-]+)\//g
  )
  for (const m of segmentMatches) {
    if (m[1] && !RESERVED_STATIC_DIRS.has(m[1])) {
      return m[1]
    }
  }

  const staticAssets = Array.from(extractAppShellAssets(html)).filter((url) =>
    url.includes('/_next/static/')
  )
  if (staticAssets.length > 0) {
    staticAssets.sort()
    return `fp-${hashString(staticAssets.join('|'))}`
  }

  return 'latest'
}

function extractAppShellAssets(html) {
  const assets = new Set()

  const staticMatches = html.match(
    /(?:\/activities)?\/_next\/static\/[a-zA-Z0-9_./-]+(?:\?[^"'\s<>]*)?/g
  )
  if (staticMatches) {
    for (const match of staticMatches) {
      assets.add(match)
    }
  }

  const iconMatches = html.match(
    /(?:\/(?:icon-192|icon-512|apple-touch-icon)\.png|\/favicon\.ico)(?:\?[^"'\s<>]*)?/g
  )
  if (iconMatches) {
    for (const match of iconMatches) {
      assets.add(match)
    }
  }

  assets.add('/manifest.webmanifest')
  assets.add('/icon-192.png')
  assets.add('/icon-512.png')
  assets.add('/apple-touch-icon.png')
  assets.add('/favicon.ico')

  return Array.from(assets)
}

async function getCurrentShellCacheKey() {
  const keys = await caches.keys()
  return keys.find((k) => k.startsWith(SHELL_CACHE_PREFIX)) || null
}

async function getCachedAppShell() {
  const keys = await caches.keys()
  const shellKeys = keys.filter((k) => k.startsWith(SHELL_CACHE_PREFIX))
  for (const key of shellKeys) {
    const cache = await caches.open(key)
    const match = await cache.match('/app')
    if (match) {
      return match
    }
  }
  return null
}

async function stageAppShell() {
  try {
    const currentActiveCacheKey = await getCurrentShellCacheKey()

    const response = await fetch('/app', { cache: 'no-store' })
    if (!response.ok) return null
    const html = await response.text()
    const buildId = extractBuildId(html)
    const targetCacheName = `${SHELL_CACHE_PREFIX}${buildId}`

    const assets = extractAppShellAssets(html)
    const targetCache = await caches.open(targetCacheName)

    await targetCache.put(
      '/app',
      new Response(html, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      })
    )

    for (const assetUrl of assets) {
      const assetRes = await fetch(assetUrl)
      if (!assetRes.ok) {
        if (targetCacheName !== currentActiveCacheKey) {
          await caches.delete(targetCacheName)
        }
        return null
      }
      await targetCache.put(assetUrl, assetRes)
    }

    const allCacheNames = await caches.keys()
    for (const name of allCacheNames) {
      if (name.startsWith(SHELL_CACHE_PREFIX) && name !== targetCacheName) {
        await caches.delete(name)
      }
    }

    return targetCacheName
  } catch {
    return null
  }
}

async function hasActiveOfflineSession() {
  if (typeof indexedDB === 'undefined') return false

  if (typeof indexedDB.databases === 'function') {
    try {
      const dbs = await indexedDB.databases()
      const exists = dbs && dbs.some((db) => db && db.name === OFFLINE_DB_NAME)
      if (!exists) return false
    } catch {
      // ignore and fall through to open check
    }
  }

  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(OFFLINE_DB_NAME)
      let upgraded = false
      req.onupgradeneeded = () => {
        upgraded = true
        try {
          req.transaction?.abort()
        } catch {
          // ignore
        }
        try {
          req.result?.close()
        } catch {
          // ignore
        }
      }
      req.onerror = () => resolve(false)
      req.onblocked = () => resolve(false)
      req.onsuccess = () => {
        const db = req.result
        if (
          upgraded ||
          !db ||
          !db.objectStoreNames ||
          !db.objectStoreNames.contains('meta')
        ) {
          try {
            db?.close()
          } catch {
            // ignore
          }
          return resolve(false)
        }
        try {
          const tx = db.transaction('meta', 'readonly')
          const store = tx.objectStore('meta')
          const getReq = store.get('activeSession')
          getReq.onsuccess = () => {
            const val = getReq.result
            try {
              db.close()
            } catch {
              // ignore
            }
            resolve(Boolean(val && val.actorId))
          }
          getReq.onerror = () => {
            try {
              db.close()
            } catch {
              // ignore
            }
            resolve(false)
          }
        } catch {
          try {
            db.close()
          } catch {
            // ignore
          }
          resolve(false)
        }
      }
    } catch {
      resolve(false)
    }
  })
}

async function trimLru(cache, maxEntries) {
  try {
    const keys = await cache.keys()
    if (keys.length > maxEntries) {
      const excess = keys.length - maxEntries
      for (let i = 0; i < excess; i++) {
        await cache.delete(keys[i])
      }
    }
  } catch {
    // safe ignore
  }
}

sw.addEventListener('install', (event) => {
  if (typeof sw.skipWaiting === 'function') {
    sw.skipWaiting()
  }
  event.waitUntil(stageAppShell())
})

sw.addEventListener('activate', (event) => {
  const c = getClients()
  const tasks = []
  if (c && typeof c.claim === 'function') tasks.push(c.claim())
  const preload = sw.registration && sw.registration.navigationPreload
  if (preload && typeof preload.enable === 'function') {
    tasks.push(preload.enable())
  }
  event.waitUntil(Promise.all(tasks))
})

sw.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Leave cross-origin requests (remote avatars, federated media, link preview
  // images) to the browser. A fetch() made here is checked against this
  // worker's own CSP `connect-src`, which names only our own and storage
  // origins, so re-fetching a remote image would be blocked and every one of
  // them would turn into the placeholder below. The page's `img-src` is what
  // allows them, and that only applies when the browser loads them itself.
  if (url.origin !== sw.location.origin) {
    return
  }

  // 1. Navigation handling
  if (request.mode === 'navigate') {
    // NEVER intercept Next.js RSC requests
    const isRsc =
      request.headers.get('rsc') === '1' || url.searchParams.has('_rsc')
    if (isRsc || request.method !== 'GET') {
      return
    }

    // The browser already sent a preload request for this navigation: use it in
    // place of a second fetch(request), and never leave it unhandled.
    const preload = Promise.resolve(event.preloadResponse).catch(
      () => undefined
    )

    if (url.pathname === '/app') {
      event.respondWith(
        (async () => {
          const cached = await getCachedAppShell()
          event.waitUntil(stageAppShell())
          if (cached) {
            return cached
          }
          return (await preload) || fetch(request)
        })()
      )
      return
    }

    if (url.pathname === '/') {
      event.respondWith(
        (async () => {
          const hasActiveSession = await hasActiveOfflineSession()
          if (hasActiveSession) {
            const cached = await getCachedAppShell()
            event.waitUntil(stageAppShell())
            if (cached) {
              return cached
            }
            return (await preload) || fetch(request)
          }

          // Unauthenticated visitors: go to network so they see <Landing>
          try {
            return (await preload) || (await fetch(request))
          } catch (_err) {
            const cached = await getCachedAppShell()
            if (cached) {
              return cached
            }
            throw _err
          }
        })()
      )
      return
    }

    // Everything else outside /api/: network first. Only a rejected fetch falls
    // back (an HTTP error or redirect is returned as is). The app shell stands
    // in for /drafts alone; any other path gets the static page, never chrome.
    if (url.pathname.startsWith('/api/')) {
      return
    }

    event.respondWith(
      (async () => {
        try {
          return (await event.preloadResponse) || (await fetch(request))
        } catch (_err) {
          if (
            (url.pathname === '/drafts' || url.pathname === '/drafts/') &&
            (await hasActiveOfflineSession())
          ) {
            const shell = await getCachedAppShell()
            if (shell) return shell
          }
          return offlinePageResponse()
        }
      })()
    )
    return
  }

  // 2. Cache-First for static Next.js assets and staged shell assets
  const isStaticAsset =
    url.pathname.startsWith('/activities/_next/static/') ||
    url.pathname.startsWith('/_next/static/')
  const isShellAsset =
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/icon-192.png' ||
    url.pathname === '/icon-512.png' ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/favicon.ico' ||
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname.endsWith('/icon-192.png') ||
    url.pathname.endsWith('/icon-512.png') ||
    url.pathname.endsWith('/apple-touch-icon.png') ||
    url.pathname.endsWith('/favicon.ico')

  if (request.method === 'GET' && (isStaticAsset || isShellAsset)) {
    event.respondWith(
      (async () => {
        let cached = await caches.match(request)
        if (!cached && isShellAsset) {
          cached = await caches.match(url.pathname)
        }
        if (cached) {
          return cached
        }
        const response = await fetch(request)
        if (response.ok) {
          const keys = await caches.keys()
          const currentShellKey = keys.find((k) =>
            k.startsWith(SHELL_CACHE_PREFIX)
          )
          if (currentShellKey) {
            const cache = await caches.open(currentShellKey)
            await cache.put(request, response.clone())
          }
        }
        return response
      })()
    )
    return
  }

  // 3. Bounded LRU Stale-While-Revalidate media cache (activities-media-v1, max 150 entries)
  if (
    request.method === 'GET' &&
    (request.destination === 'image' ||
      url.pathname.startsWith('/api/v1/files/'))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE_NAME)
        const cached = await cache.match(request)

        const fetchPromise = fetch(request)
          .then(async (networkResponse) => {
            if (networkResponse.ok || networkResponse.type === 'opaque') {
              await cache.put(request, networkResponse.clone())
              await trimLru(cache, MAX_MEDIA_ENTRIES)
            }
            return networkResponse
          })
          .catch(() => null)

        if (cached) {
          event.waitUntil(fetchPromise)
          return cached
        }

        const networkResult = await fetchPromise
        if (networkResult) {
          return networkResult
        }

        return getSvgPlaceholderResponse()
      })()
    )
    return
  }
})

sw.addEventListener('push', (event) => {
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

  if (
    sw.registration &&
    typeof sw.registration.showNotification === 'function'
  ) {
    event.waitUntil(sw.registration.showNotification(title, options))
  }
})

sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(
    event.notification.data?.url || '/notifications',
    sw.location.origin
  ).href

  const c = getClients()
  if (c && typeof c.matchAll === 'function') {
    event.waitUntil(
      c
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            if (client.url === url && 'focus' in client) {
              return client.focus()
            }
          }
          return c.openWindow(url)
        })
    )
  }
})
