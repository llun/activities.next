import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Service Worker (public/sw.js)', () => {
  let eventListeners: Record<string, ((event: any) => void)[]>
  let cacheStore: Map<string, Map<string, Response>>
  let mockFetch: ReturnType<typeof vi.fn>
  let mockClients: any
  let mockRegistration: any
  let swModule: any

  beforeEach(() => {
    eventListeners = {}
    cacheStore = new Map()
    const cacheInstances = new Map<string, any>()

    const createMockCache = (name: string) => {
      if (cacheInstances.has(name)) {
        return cacheInstances.get(name)
      }
      if (!cacheStore.has(name)) {
        cacheStore.set(name, new Map())
      }
      const store = cacheStore.get(name)!
      const instance = {
        match: vi.fn(async (req: any) => {
          const key = typeof req === 'string' ? req : req.url
          return store.get(key) || null
        }),
        put: vi.fn(async (req: any, res: Response) => {
          const key = typeof req === 'string' ? req : req.url
          store.set(key, res)
        }),
        delete: vi.fn(async (req: any) => {
          const key = typeof req === 'string' ? req : req.url
          return store.delete(key)
        }),
        keys: vi.fn(async () => {
          return Array.from(store.keys()).map((k) => new Request(k))
        })
      }
      cacheInstances.set(name, instance)
      return instance
    }

    const mockCaches = {
      open: vi.fn(async (name: string) => createMockCache(name)),
      delete: vi.fn(async (name: string) => {
        cacheInstances.delete(name)
        return cacheStore.delete(name)
      }),
      keys: vi.fn(async () => Array.from(cacheStore.keys())),
      match: vi.fn(async (req: any) => {
        const key = typeof req === 'string' ? req : req.url
        for (const store of cacheStore.values()) {
          const res = store.get(key)
          if (res) return res
        }
        return null
      })
    }

    mockClients = {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async (_url: string) => ({}))
    }

    mockRegistration = {
      showNotification: vi.fn(async () => {})
    }

    mockFetch = vi.fn()

    const mockSelf: any = {
      addEventListener: vi.fn((type: string, cb: any) => {
        if (!eventListeners[type]) eventListeners[type] = []
        eventListeners[type].push(cb)
      }),
      skipWaiting: vi.fn(),
      registration: mockRegistration,
      location: { origin: 'https://llun.social' }
    }

    // Assign to global
    vi.stubGlobal('self', mockSelf)
    vi.stubGlobal('clients', mockClients)
    vi.stubGlobal('caches', mockCaches)
    vi.stubGlobal('fetch', mockFetch)
    ;(globalThis as any).self = mockSelf
    ;(globalThis as any).clients = mockClients
    ;(globalThis as any).caches = mockCaches
    ;(globalThis as any).fetch = mockFetch

    // Load sw.js fresh
    const swPath = path.join(process.cwd(), 'public/sw.js')
    const swCode = fs.readFileSync(swPath, 'utf-8')
    const runSw = new Function(
      'self',
      'clients',
      'caches',
      'fetch',
      'Response',
      'Request',
      `${swCode}
return {
  MEDIA_CACHE_NAME,
  MAX_MEDIA_ENTRIES,
  SHELL_CACHE_PREFIX,
  extractBuildId,
  extractAppShellAssets,
  stageAppShell,
  getCachedAppShell,
  hasActiveOfflineSession,
  trimLru,
  getSvgPlaceholderResponse
};`
    )
    swModule = runSw(
      mockSelf,
      mockClients,
      mockCaches,
      mockFetch,
      Response,
      Request
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('extractBuildId and extractAppShellAssets', () => {
    it('extracts build ID from Next.js manifest path', () => {
      const html =
        '<html><head><script src="/activities/_next/static/build-123/_buildManifest.js"></script></head></html>'
      expect(swModule.extractBuildId(html)).toBe('build-123')
    })

    it('extracts build ID from JSON config fallback', () => {
      const html = '<html><script>{"buildId":"json-build-456"}</script></html>'
      expect(swModule.extractBuildId(html)).toBe('json-build-456')
    })

    it('extracts all referenced static assets and icons', () => {
      const html = `
        <html>
          <head>
            <link rel="stylesheet" href="/activities/_next/static/css/styles.css?v=1" />
            <script src="/_next/static/chunks/app.js"></script>
            <link rel="icon" href="/favicon.ico?v=2" />
          </head>
        </html>
      `
      const assets = swModule.extractAppShellAssets(html)
      expect(assets).toContain('/activities/_next/static/css/styles.css?v=1')
      expect(assets).toContain('/_next/static/chunks/app.js')
      expect(assets).toContain('/favicon.ico?v=2')
      expect(assets).toContain('/manifest.webmanifest')
      expect(assets).toContain('/icon-192.png')
      expect(assets).toContain('/icon-512.png')
    })

    it('ignores reserved static subdirectories like chunks when extracting build ID and finds valid segment or deterministic fingerprint', () => {
      const htmlWithBuild = `
        <html><head>
          <script src="/_next/static/chunks/main.js"></script>
          <script src="/_next/static/css/styles.css"></script>
          <script src="/_next/static/release-xyz/bundle.js"></script>
        </head></html>
      `
      expect(swModule.extractBuildId(htmlWithBuild)).toBe('release-xyz')

      const htmlChunksOnly = `
        <html><head>
          <script src="/_next/static/chunks/main-abc.js"></script>
          <link rel="stylesheet" href="/_next/static/css/styles-def.css" />
        </head></html>
      `
      const buildId = swModule.extractBuildId(htmlChunksOnly)
      expect(buildId).toMatch(/^fp-[a-z0-9]+$/)
      expect(swModule.extractBuildId(htmlChunksOnly)).toBe(buildId)
    })
  })

  describe('stageAppShell', () => {
    it('stages /app and all assets into activities-shell-<buildId> and deletes older shell caches upon success', async () => {
      const html = `
        <html>
          <head>
            <script src="/activities/_next/static/build-789/_buildManifest.js"></script>
            <link rel="stylesheet" href="/activities/_next/static/style.css" />
          </head>
        </html>
      `

      // Pre-seed an older shell cache
      const oldCache = await caches.open('activities-shell-old-111')
      await oldCache.put(
        '/app',
        new Response('old app', {
          headers: { 'Content-Type': 'text/html' }
        })
      )

      mockFetch.mockImplementation(async (url: string) => {
        if (url === '/app') {
          return new Response(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
          })
        }
        return new Response('asset content', { status: 200 })
      })

      const promotedCacheName = await swModule.stageAppShell()
      expect(promotedCacheName).toBe('activities-shell-build-789')

      const allKeys = await caches.keys()
      expect(allKeys).toContain('activities-shell-build-789')
      expect(allKeys).not.toContain('activities-shell-old-111')

      const newCache = await caches.open('activities-shell-build-789')
      const appRes = await newCache.match('/app')
      expect(appRes).toBeDefined()
    })

    it('aborts staging and preserves older shell caches if an asset fetch fails', async () => {
      const html = `
        <html>
          <head>
            <script src="/activities/_next/static/build-fail/_buildManifest.js"></script>
            <link rel="stylesheet" href="/activities/_next/static/broken.css" />
          </head>
        </html>
      `

      const oldCache = await caches.open('activities-shell-preserved')
      await oldCache.put('/app', new Response('preserved app'))

      mockFetch.mockImplementation(async (url: string) => {
        if (url === '/app') {
          return new Response(html, { status: 200 })
        }
        if (url === '/activities/_next/static/broken.css') {
          return new Response('Not found', { status: 404 })
        }
        return new Response('ok', { status: 200 })
      })

      const result = await swModule.stageAppShell()
      expect(result).toBeNull()

      const allKeys = await caches.keys()
      expect(allKeys).toContain('activities-shell-preserved')
      expect(allKeys).not.toContain('activities-shell-build-fail')
    })

    it('does not delete the target shell cache if it is already the active shell cache when an asset fetch fails', async () => {
      const activeCacheName = 'activities-shell-active-1'
      const activeCache = await caches.open(activeCacheName)
      await activeCache.put('/app', new Response('active app'))

      const html = `
        <html><head>
          <script src="/activities/_next/static/active-1/_buildManifest.js"></script>
          <link rel="stylesheet" href="/activities/_next/static/flaky.css" />
        </head></html>
      `

      mockFetch.mockImplementation(async (url: string) => {
        if (url === '/app') {
          return new Response(html, { status: 200 })
        }
        if (url === '/activities/_next/static/flaky.css') {
          return new Response('Server Error', { status: 500 })
        }
        return new Response('ok', { status: 200 })
      })

      const result = await swModule.stageAppShell()
      expect(result).toBeNull()

      const allKeys = await caches.keys()
      expect(allKeys).toContain(activeCacheName)
    })
  })

  describe('hasActiveOfflineSession', () => {
    it('returns false immediately when indexedDB.databases() does not contain OFFLINE_DB_NAME without calling open()', async () => {
      const mockOpen = vi.fn()
      const mockIdb = {
        databases: vi.fn().mockResolvedValue([{ name: 'other_db' }]),
        open: mockOpen
      }
      vi.stubGlobal('indexedDB', mockIdb)
      ;(globalThis as any).indexedDB = mockIdb

      const hasSession = await swModule.hasActiveOfflineSession()
      expect(hasSession).toBe(false)
      expect(mockOpen).not.toHaveBeenCalled()
    })

    it('aborts upgrade transaction and closes db when onupgradeneeded triggers, returning false', async () => {
      const abortFn = vi.fn()
      const closeFn = vi.fn()
      const mockIdb = {
        open: vi.fn(() => {
          const req: any = {
            transaction: { abort: abortFn },
            result: {
              close: closeFn,
              objectStoreNames: { contains: () => false }
            }
          }
          setTimeout(() => {
            if (req.onupgradeneeded) req.onupgradeneeded()
            if (req.onerror) req.onerror()
          }, 0)
          return req
        })
      }
      vi.stubGlobal('indexedDB', mockIdb)
      ;(globalThis as any).indexedDB = mockIdb

      const hasSession = await swModule.hasActiveOfflineSession()
      expect(hasSession).toBe(false)
      expect(abortFn).toHaveBeenCalled()
      expect(closeFn).toHaveBeenCalled()
    })
  })

  describe('fetch event listener', () => {
    const triggerFetch = async (
      req: Request
    ): Promise<{
      response: Response | null
      waitUntil: Promise<any>
    }> => {
      let respondedWith: Promise<Response> | null = null
      const waitUntilPromises: Promise<any>[] = []

      const event = {
        request: req,
        respondWith: (promise: Promise<Response>) => {
          respondedWith = promise
        },
        waitUntil: (promise: Promise<any>) => {
          waitUntilPromises.push(promise)
        }
      }

      for (const listener of eventListeners['fetch'] || []) {
        listener(event)
        if (respondedWith) break
      }

      return {
        response: respondedWith ? await respondedWith : null,
        waitUntil: Promise.all(waitUntilPromises)
      }
    }

    it('NEVER intercepts Next.js RSC requests', async () => {
      const reqHeader = new Request('https://llun.social/app', {
        headers: { rsc: '1' }
      })
      Object.defineProperty(reqHeader, 'mode', { value: 'navigate' })
      const resHeader = await triggerFetch(reqHeader)
      expect(resHeader.response).toBeNull()

      const reqQuery = new Request('https://llun.social/app?_rsc=abc')
      Object.defineProperty(reqQuery, 'mode', { value: 'navigate' })
      const resQuery = await triggerFetch(reqQuery)
      expect(resQuery.response).toBeNull()
    })

    it('serves cached /app immediately for GET /app and triggers background staging', async () => {
      const shellCache = await caches.open('activities-shell-v1')
      await shellCache.put(
        '/app',
        new Response('<h1>Cached App Shell</h1>', {
          headers: { 'Content-Type': 'text/html' }
        })
      )

      mockFetch.mockResolvedValue(
        new Response('<h1>Fresh App Shell</h1>', { status: 200 })
      )

      const req = new Request('https://llun.social/app')
      Object.defineProperty(req, 'mode', { value: 'navigate' })

      const { response, waitUntil } = await triggerFetch(req)
      expect(response).not.toBeNull()
      const text = await response!.text()
      expect(text).toBe('<h1>Cached App Shell</h1>')

      await waitUntil
      expect(mockFetch).toHaveBeenCalledWith('/app', { cache: 'no-store' })
    })

    it('serves cached /app for GET / when active offline session exists', async () => {
      // Mock IndexedDB with active session
      const mockIdb = {
        open: vi.fn(() => {
          const req: any = {}
          setTimeout(() => {
            req.result = {
              objectStoreNames: { contains: (name: string) => name === 'meta' },
              transaction: () => ({
                objectStore: () => ({
                  get: () => {
                    const getReq: any = {}
                    setTimeout(() => {
                      getReq.result = {
                        key: 'activeSession',
                        actorId: 'actor-1'
                      }
                      if (getReq.onsuccess) getReq.onsuccess()
                    }, 0)
                    return getReq
                  }
                })
              }),
              close: vi.fn()
            }
            if (req.onsuccess) req.onsuccess()
          }, 0)
          return req
        })
      }
      vi.stubGlobal('indexedDB', mockIdb)
      ;(globalThis as any).indexedDB = mockIdb

      const shellCache = await caches.open('activities-shell-v1')
      await shellCache.put(
        '/app',
        new Response('<h1>Signed-in Shell</h1>', {
          headers: { 'Content-Type': 'text/html' }
        })
      )

      const req = new Request('https://llun.social/')
      Object.defineProperty(req, 'mode', { value: 'navigate' })

      const { response } = await triggerFetch(req)
      expect(response).not.toBeNull()
      const text = await response!.text()
      expect(text).toBe('<h1>Signed-in Shell</h1>')
    })

    it('goes to network for GET / when no active offline session exists, falling back to cache on failure', async () => {
      const mockIdb = {
        open: vi.fn(() => {
          const req: any = {}
          setTimeout(() => {
            req.result = {
              objectStoreNames: { contains: () => false },
              close: vi.fn()
            }
            if (req.onsuccess) req.onsuccess()
          }, 0)
          return req
        })
      }
      vi.stubGlobal('indexedDB', mockIdb)
      ;(globalThis as any).indexedDB = mockIdb

      // Network succeeds: returns Landing page
      mockFetch.mockResolvedValueOnce(
        new Response('<h1>Landing</h1>', { status: 200 })
      )

      const req = new Request('https://llun.social/')
      Object.defineProperty(req, 'mode', { value: 'navigate' })

      const { response: landingRes } = await triggerFetch(req)
      expect(landingRes).not.toBeNull()
      expect(await landingRes!.text()).toBe('<h1>Landing</h1>')

      // Network fails: falls back to cached shell if available
      const shellCache = await caches.open('activities-shell-v1')
      await shellCache.put('/app', new Response('<h1>Fallback Shell</h1>'))

      mockFetch.mockRejectedValueOnce(new Error('Network offline'))

      const { response: fallbackRes } = await triggerFetch(req)
      expect(fallbackRes).not.toBeNull()
      expect(await fallbackRes!.text()).toBe('<h1>Fallback Shell</h1>')
    })

    describe('other navigations', () => {
      const navigate = (path: string) => {
        const req = new Request(`https://llun.social${path}`)
        Object.defineProperty(req, 'mode', { value: 'navigate' })
        return triggerFetch(req)
      }
      const stubSession = () => {
        const mockIdb = {
          open: vi.fn(() => {
            const req: any = {}
            setTimeout(() => {
              req.result = {
                objectStoreNames: { contains: () => true },
                transaction: () => ({
                  objectStore: () => ({
                    get: () => {
                      const getReq: any = {}
                      setTimeout(() => {
                        getReq.result = { actorId: 'actor-1' }
                        getReq.onsuccess?.()
                      }, 0)
                      return getReq
                    }
                  })
                }),
                close: vi.fn()
              }
              req.onsuccess?.()
            }, 0)
            return req
          })
        }
        vi.stubGlobal('indexedDB', mockIdb)
        ;(globalThis as any).indexedDB = mockIdb
      }
      const seedShell = async () => {
        const cache = await caches.open('activities-shell-v1')
        await cache.put(
          '/app',
          new Response('<h1>Signed-in Shell</h1>', {
            headers: { 'Content-Type': 'text/html' }
          })
        )
        ;(cache.put as unknown as ReturnType<typeof vi.fn>).mockClear()
      }
      const expectOfflinePage = async (response: Response | null) => {
        expect(response!.headers.get('Cache-Control')).toBe('no-store')
        expect(response!.headers.get('Content-Type')).toContain('text/html')
        const text = await response!.text()
        expect(text).toContain('<h1>Not saved for offline</h1>')
        expect(text).not.toContain('Signed-in Shell')
      }

      it('serves the cached shell for /drafts when the fetch rejects with a session', async () => {
        stubSession()
        await seedShell()
        mockFetch.mockRejectedValue(new TypeError('offline'))

        const { response } = await navigate('/drafts')
        expect(await response!.text()).toBe('<h1>Signed-in Shell</h1>')
      })

      it('serves the offline page for /drafts without a session or without a shell', async () => {
        mockFetch.mockRejectedValue(new TypeError('offline'))
        const noSession = (await navigate('/drafts')).response
        await expectOfflinePage(noSession)

        stubSession()
        const noShell = (await navigate('/drafts')).response
        await expectOfflinePage(noShell)
      })

      it.each(['/notifications', '/auth/signin', '/oauth/authorize', '/admin'])(
        'serves the offline page, never the shell, for %s while offline with a session and a shell',
        async (path) => {
          stubSession()
          await seedShell()
          mockFetch.mockRejectedValue(new TypeError('offline'))

          const { response } = await navigate(path)
          await expectOfflinePage(response)
        }
      )

      it('returns the network response, including a 500, instead of the fallback', async () => {
        stubSession()
        await seedShell()
        mockFetch.mockResolvedValue(new Response('boom', { status: 500 }))

        const { response } = await navigate('/drafts')
        expect(response!.status).toBe(500)
        expect(await response!.text()).toBe('boom')
      })

      it('prefers the navigation preload response when present', async () => {
        const preload = new Response('<p>preloaded</p>')
        const req = new Request('https://llun.social/notifications')
        Object.defineProperty(req, 'mode', { value: 'navigate' })
        let responded: Promise<Response> | null = null
        eventListeners['fetch'][0]({
          request: req,
          preloadResponse: Promise.resolve(preload),
          respondWith: (p: Promise<Response>) => {
            responded = p
          },
          waitUntil: () => {}
        })

        expect(await responded!).toBe(preload)
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('does not intercept /api/ navigations or non-GET requests', async () => {
        expect((await navigate('/api/v1/accounts')).response).toBeNull()

        const post = new Request('https://llun.social/notifications', {
          method: 'POST'
        })
        Object.defineProperty(post, 'mode', { value: 'navigate' })
        expect((await triggerFetch(post)).response).toBeNull()
      })

      it('never writes an HTML navigation response to a cache', async () => {
        stubSession()
        await seedShell()
        mockFetch.mockResolvedValue(new Response('<html></html>'))
        await navigate('/drafts')
        mockFetch.mockRejectedValue(new TypeError('offline'))
        await navigate('/notifications')

        for (const name of cacheStore.keys()) {
          expect((await caches.open(name)).put).not.toHaveBeenCalled()
        }
      })
    })

    it('enables navigation preload on activate', async () => {
      const enable = vi.fn(async () => {})
      mockRegistration.navigationPreload = { enable }
      let done: Promise<any> | null = null
      eventListeners['activate'][0]({
        waitUntil: (p: Promise<any>) => {
          done = p
        }
      })
      await done
      expect(enable).toHaveBeenCalled()
      expect(mockClients.claim).toHaveBeenCalled()
    })

    it('uses Cache-First for /activities/_next/static/* and /_next/static/*', async () => {
      const shellCache = await caches.open('activities-shell-v1')
      await shellCache.put(
        'https://llun.social/activities/_next/static/chunk-1.js',
        new Response('cached chunk')
      )

      const req = new Request(
        'https://llun.social/activities/_next/static/chunk-1.js'
      )
      const { response } = await triggerFetch(req)
      expect(response).not.toBeNull()
      expect(await response!.text()).toBe('cached chunk')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('serves /manifest.webmanifest and /icon-192.png from active shell cache while offline', async () => {
      const shellCache = await caches.open('activities-shell-v1')
      await shellCache.put(
        '/manifest.webmanifest',
        new Response('{"name":"Activities"}', {
          headers: { 'Content-Type': 'application/manifest+json' }
        })
      )
      await shellCache.put(
        '/icon-192.png',
        new Response('fake-icon-bytes', {
          headers: { 'Content-Type': 'image/png' }
        })
      )

      const manifestReq = new Request(
        'https://llun.social/manifest.webmanifest'
      )
      const { response: manifestRes } = await triggerFetch(manifestReq)
      expect(manifestRes).not.toBeNull()
      expect(await manifestRes!.text()).toBe('{"name":"Activities"}')

      const iconReq = new Request('https://llun.social/icon-192.png')
      const { response: iconRes } = await triggerFetch(iconReq)
      expect(iconRes).not.toBeNull()
      expect(await iconRes!.text()).toBe('fake-icon-bytes')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('fetches and caches uncached static Next.js assets with await cache.put', async () => {
      const shellCache = await caches.open('activities-shell-v2')
      const putSpy = vi.spyOn(shellCache, 'put')

      mockFetch.mockResolvedValueOnce(
        new Response('console.log("chunk 2")', {
          status: 200,
          headers: { 'Content-Type': 'application/javascript' }
        })
      )

      const req = new Request(
        'https://llun.social/activities/_next/static/chunk-2.js'
      )
      const { response } = await triggerFetch(req)
      expect(response).not.toBeNull()
      expect(await response!.text()).toBe('console.log("chunk 2")')
      expect(putSpy).toHaveBeenCalledWith(req, expect.any(Response))
    })

    it('implements Stale-While-Revalidate with LRU bounding for images, returning SVG placeholder when offline and uncached', async () => {
      const mediaCache = await caches.open('activities-media-v1')
      await mediaCache.put(
        'https://llun.social/avatar.jpg',
        new Response('cached image bytes')
      )

      mockFetch.mockResolvedValueOnce(new Response('fresh image bytes'))

      const req = new Request('https://llun.social/avatar.jpg')
      Object.defineProperty(req, 'destination', { value: 'image' })

      // SWR: returns cached image immediately
      const { response, waitUntil } = await triggerFetch(req)
      expect(response).not.toBeNull()
      expect(await response!.text()).toBe('cached image bytes')

      await waitUntil
      expect(mockFetch).toHaveBeenCalledWith(req)

      // Uncached and offline: returns SVG placeholder
      mockFetch.mockRejectedValueOnce(new Error('Network offline'))
      const uncachedReq = new Request('https://llun.social/uncached.png')
      Object.defineProperty(uncachedReq, 'destination', { value: 'image' })

      const { response: offlineRes } = await triggerFetch(uncachedReq)
      expect(offlineRes).not.toBeNull()
      expect(offlineRes!.status).toBe(200)
      expect(offlineRes!.headers.get('Content-Type')).toBe('image/svg+xml')
      const svgText = await offlineRes!.text()
      expect(svgText).toContain('<svg')
    })

    it('leaves cross-origin images to the browser instead of re-fetching them', async () => {
      // A worker fetch() is checked against the worker's connect-src, which
      // does not allow remote hosts, so intercepting would turn every remote
      // avatar and attachment into the placeholder.
      const req = new Request(
        'https://files.mastodon.social/accounts/avatars/1/original/a.png'
      )
      Object.defineProperty(req, 'destination', { value: 'image' })

      const { response } = await triggerFetch(req)
      expect(response).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('enforces LRU max 150 entries on media cache', async () => {
      const mediaCache = await caches.open('activities-media-v1')
      // Fill with 155 entries
      for (let i = 0; i < 155; i++) {
        await mediaCache.put(`https://llun.social/img-${i}.jpg`, new Response())
      }

      await swModule.trimLru(mediaCache, 150)
      const remaining = await mediaCache.keys()
      expect(remaining.length).toBe(150)
    })
  })

  describe('push and notificationclick listeners', () => {
    it('shows notification on push event', async () => {
      const event: any = {
        data: {
          json: () => ({
            title: 'New Mention',
            body: 'Hello @alice',
            icon: '/avatar.jpg',
            url: '/notifications'
          })
        },
        waitUntil: vi.fn()
      }

      for (const listener of eventListeners['push'] || []) {
        listener(event)
      }

      expect(mockRegistration.showNotification).toHaveBeenCalledWith(
        'New Mention',
        expect.objectContaining({
          body: 'Hello @alice',
          icon: '/avatar.jpg',
          data: { url: '/notifications' }
        })
      )
    })

    it('closes notification and focuses matching client on notificationclick', async () => {
      const mockClient = {
        url: 'https://llun.social/notifications',
        focus: vi.fn()
      }
      mockClients.matchAll.mockResolvedValueOnce([mockClient])

      const event: any = {
        notification: {
          close: vi.fn(),
          data: { url: '/notifications' }
        },
        waitUntil: vi.fn((p) => p)
      }

      for (const listener of eventListeners['notificationclick'] || []) {
        listener(event)
      }

      expect(event.notification.close).toHaveBeenCalled()
      await Promise.all(event.waitUntil.mock.results.map((r: any) => r.value))
      expect(mockClient.focus).toHaveBeenCalled()
    })
  })
})
