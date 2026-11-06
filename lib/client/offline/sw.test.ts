import { IDBFactory } from 'fake-indexeddb'
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
      'indexedDB',
      `${swCode}
return {
  MEDIA_CACHE_NAME,
  MAX_MEDIA_ENTRIES,
  SHELL_CACHE_PREFIX,
  SHARE_TARGET_PATH,
  SHARE_TARGET_DB_NAME,
  SHARE_TARGET_DB_VERSION,
  SHARE_TARGET_STORE,
  SHARE_TARGET_TTL_MS,
  SHARE_TARGET_MAX_TOTAL_BYTES,
  SHARE_TARGET_MAX_TEXT_LENGTH,
  SHARE_TARGET_MAX_RECORDS,
  SHARE_PURGE_CACHE,
  SHARE_PURGE_CACHE_KEY,
  extractBuildId,
  extractAppShellAssets,
  stageAppShell,
  getCachedAppShell,
  hasActiveOfflineSession,
  trimLru,
  getSvgPlaceholderResponse,
  openShareTargetDb,
  pruneExpiredShares,
  stageShareTarget,
  handleShareTarget
};`
    )
    swModule = runSw(
      mockSelf,
      mockClients,
      mockCaches,
      mockFetch,
      Response,
      Request,
      // Read through to the global on every access: the tests below swap in a
      // fresh fake-indexeddb factory per case, after the worker is loaded.
      new Proxy(
        {},
        {
          get: (_target, property) =>
            (globalThis as any).indexedDB?.[property as any]
        }
      )
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

    it('passes Next.js RSC requests straight to the network, never the shell', async () => {
      const shellCache = await caches.open('activities-shell-v1')
      await shellCache.put('/app', new Response('<h1>Cached App Shell</h1>'))

      const reqHeader = new Request('https://llun.social/app', {
        headers: { rsc: '1' }
      })
      Object.defineProperty(reqHeader, 'mode', { value: 'navigate' })
      const fromHeader = new Response('rsc payload')
      mockFetch.mockResolvedValueOnce(fromHeader)
      expect((await triggerFetch(reqHeader)).response).toBe(fromHeader)

      const reqQuery = new Request('https://llun.social/app?_rsc=abc')
      Object.defineProperty(reqQuery, 'mode', { value: 'navigate' })
      const fromQuery = new Response('rsc payload')
      mockFetch.mockResolvedValueOnce(fromQuery)
      expect((await triggerFetch(reqQuery)).response).toBe(fromQuery)
      expect(mockFetch).toHaveBeenCalledTimes(2)
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

      it('serves the cached shell for /drafts/ too', async () => {
        stubSession()
        await seedShell()
        mockFetch.mockRejectedValue(new TypeError('offline'))

        const { response } = await navigate('/drafts/')
        expect(await response!.text()).toBe('<h1>Signed-in Shell</h1>')
      })

      it('serves the offline page for /drafts without a session, even with a shell', async () => {
        mockFetch.mockRejectedValue(new TypeError('offline'))
        await seedShell()
        await expectOfflinePage((await navigate('/drafts')).response)
      })

      it('serves the offline page for /drafts with a session but no shell', async () => {
        mockFetch.mockRejectedValue(new TypeError('offline'))
        stubSession()
        await expectOfflinePage((await navigate('/drafts')).response)
      })

      it.each([
        '/notifications',
        '/auth/signin',
        '/oauth/authorize',
        '/admin',
        '/draftsX',
        '/drafts/x'
      ])(
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

      it.each(['/', '/app'])(
        'uses the navigation preload for %s instead of a second fetch',
        async (path) => {
          const preload = new Response('<p>preloaded</p>')
          const req = new Request(`https://llun.social${path}`)
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
          // /app also stages the shell in the background; that is not the navigation.
          expect(mockFetch).not.toHaveBeenCalledWith(req)
        }
      )

      it('ignores (never leaves unhandled) a preload when / is served from the shell', async () => {
        stubSession()
        await seedShell()
        const preloadResponse = Promise.resolve(undefined)
        const catchSpy = vi.spyOn(preloadResponse, 'catch')
        const req = new Request('https://llun.social/')
        Object.defineProperty(req, 'mode', { value: 'navigate' })
        let responded: Promise<Response> | null = null
        eventListeners['fetch'][0]({
          request: req,
          preloadResponse,
          respondWith: (p: Promise<Response>) => {
            responded = p
          },
          waitUntil: () => {}
        })

        expect(await (await responded!).text()).toBe('<h1>Signed-in Shell</h1>')
        expect(catchSpy).toHaveBeenCalled()
        expect(mockFetch).not.toHaveBeenCalledWith(req)
      })

      it('answers an /api/ navigation from its preload, so a one-time callback reaches the server once', async () => {
        const preload = new Response(null, { status: 302 })
        const req = new Request(
          'https://llun.social/api/v1/fitness/strava/callback?code=abc&state=s'
        )
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

      it('never stands the offline page in for an /api/ navigation', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('offline'))
        const req = new Request(
          'https://llun.social/api/v1/fitness/strava/callback?code=a'
        )
        Object.defineProperty(req, 'mode', { value: 'navigate' })
        let responded: Promise<Response> | null = null
        eventListeners['fetch'][0]({
          request: req,
          preloadResponse: Promise.resolve(undefined),
          respondWith: (p: Promise<Response>) => {
            responded = p
          },
          waitUntil: () => {}
        })

        await expect(responded!).rejects.toThrow('offline')
      })

      it('fetches an /api/ navigation once when there is no preload, and leaves non-GET requests alone', async () => {
        const fetched = new Response('{}')
        mockFetch.mockResolvedValueOnce(fetched)
        expect((await navigate('/api/v1/accounts')).response).toBe(fetched)
        expect(mockFetch).toHaveBeenCalledTimes(1)

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

  describe('Web Share Target', () => {
    const readAllShares = async (): Promise<any[]> => {
      const db = await swModule.openShareTargetDb()
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(swModule.SHARE_TARGET_STORE, 'readonly')
          const request = tx.objectStore(swModule.SHARE_TARGET_STORE).getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      } finally {
        db.close()
      }
    }

    const writeShare = async (record: any) => {
      const db = await swModule.openShareTargetDb()
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(swModule.SHARE_TARGET_STORE, 'readwrite')
          tx.objectStore(swModule.SHARE_TARGET_STORE).put(record)
          tx.oncomplete = () => resolve(undefined)
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    }

    // An OS share launch: a top-level navigation. A constructed Request
    // cannot have mode `navigate`, so it is defined on the instance.
    const shareRequest = (
      files: File[],
      fields: Record<string, string> = {},
      {
        mode = 'navigate',
        destination = 'document',
        headers = {}
      }: {
        mode?: string
        destination?: string
        headers?: Record<string, string>
      } = {}
    ) => {
      const form = new FormData()
      for (const [key, value] of Object.entries(fields)) form.set(key, value)
      for (const file of files) form.append('files', file)
      const request = new Request('https://llun.social/_share-target', {
        method: 'POST',
        body: form,
        headers
      })
      Object.defineProperty(request, 'mode', { value: mode })
      Object.defineProperty(request, 'destination', { value: destination })
      return request
    }

    const photoFile = () => new File(['x'], 'photo.jpg', { type: 'image/jpeg' })

    const triggerFetch = async (req: Request): Promise<Response | null> => {
      // Assigned inside the listener, which TypeScript's narrowing cannot see.
      let respondedWith = null as Promise<Response> | null
      const event = {
        request: req,
        respondWith: (promise: Promise<Response>) => {
          respondedWith = promise
        },
        waitUntil: vi.fn()
      }
      for (const listener of eventListeners['fetch'] || []) {
        listener(event)
        if (respondedWith) break
      }
      return respondedWith ? await respondedWith : null
    }

    beforeEach(() => {
      vi.stubGlobal('indexedDB', new IDBFactory())
    })

    it('stages the shared files and answers 303 to the composer', async () => {
      const photo = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', {
        type: 'image/jpeg'
      })
      const workout = new File([new Uint8Array([4, 5])], 'run.fit', {
        type: 'application/vnd.ant.fit'
      })

      const response = await triggerFetch(
        shareRequest([photo, workout], { title: 'Morning run', text: 'hi' })
      )

      expect(response).not.toBeNull()
      expect(response!.status).toBe(303)
      const location = response!.headers.get('Location')!
      expect(location).toMatch(/^\/app\?share=/)
      const id = decodeURIComponent(location.split('share=')[1])

      const shares = await readAllShares()
      expect(shares).toHaveLength(1)
      const [share] = shares
      expect(share.id).toBe(id)
      expect(typeof share.createdAt).toBe('number')
      expect(share.title).toBe('Morning run')
      expect(share.text).toBe('hi')
      expect(share.files).toHaveLength(2)
      expect(share.files[0]).toMatchObject({
        name: 'photo.jpg',
        type: 'image/jpeg',
        size: 3
      })
      expect(share.files[0].bytes).toBeInstanceOf(ArrayBuffer)
      expect(Array.from(new Uint8Array(share.files[0].bytes))).toEqual([
        1, 2, 3
      ])
      expect(share.files[1].name).toBe('run.fit')
    })

    // The worker and the client open the same database: a drift in its name,
    // version or store would leave every share unreadable.
    it('names the staging database as the client does', async () => {
      const client = await import('@/lib/client/share-target/types')

      expect(swModule.SHARE_TARGET_DB_NAME).toBe(client.SHARE_TARGET_DB_NAME)
      expect(swModule.SHARE_TARGET_DB_VERSION).toBe(
        client.SHARE_TARGET_DB_VERSION
      )
      expect(swModule.SHARE_TARGET_STORE).toBe(client.SHARE_TARGET_STORE)
      expect(swModule.SHARE_TARGET_TTL_MS).toBe(client.SHARE_TARGET_TTL_MS)
      const purge = await import('@/lib/client/share-target/pendingSharePurge')
      expect(swModule.SHARE_PURGE_CACHE).toBe(purge.SHARE_PURGE_CACHE)
      expect(swModule.SHARE_PURGE_CACHE_KEY).toBe(purge.SHARE_PURGE_CACHE_KEY)
    })

    it.each(['cross-site', 'same-site'])(
      'refuses a share whose Sec-Fetch-Site is %s, staging nothing',
      async (site) => {
        const response = await triggerFetch(
          shareRequest(
            [photoFile()],
            {},
            {
              headers: { 'Sec-Fetch-Site': site }
            }
          )
        )

        expect(response!.status).toBe(303)
        expect(response!.headers.get('Location')).toBe('/app')
        expect(await readAllShares()).toEqual([])
      }
    )

    // A navigation inside a frame another site embeds is not a share launch.
    it('refuses a share navigation that is not for a document', async () => {
      const response = await triggerFetch(
        shareRequest([photoFile()], {}, { destination: 'iframe' })
      )

      expect(response!.headers.get('Location')).toBe('/app')
      expect(await readAllShares()).toEqual([])
    })

    it('refuses a share that is not a navigation, staging nothing', async () => {
      const response = await triggerFetch(
        shareRequest([photoFile()], {}, { mode: 'cors' })
      )

      expect(response!.status).toBe(303)
      expect(response!.headers.get('Location')).toBe('/app')
      expect(await readAllShares()).toEqual([])
    })

    it.each([['none'], ['same-origin'], [undefined]])(
      'stages a navigation share whose Sec-Fetch-Site is %s',
      async (site) => {
        const response = await triggerFetch(
          shareRequest(
            [photoFile()],
            {},
            {
              headers: site ? { 'Sec-Fetch-Site': site } : {}
            }
          )
        )

        expect(response!.headers.get('Location')).toMatch(/^\/app\?share=/)
        expect(await readAllShares()).toHaveLength(1)
      }
    )

    // The intake shows these in its skip notice, so none is dropped silently.
    // The pages copy a failed sign-out's purge marker to Cache Storage (a
    // worker has no localStorage). The next stage deletes the shares staged
    // up to the sign-out, keeps later ones, and drops the marker.
    it("purges a failed sign-out's shares before staging a new one", async () => {
      const markedAt = Date.now() - 1000
      await writeShare({ id: 'old', createdAt: markedAt - 10, files: [] })
      await writeShare({ id: 'later', createdAt: markedAt + 10, files: [] })
      const cache = await (globalThis as any).caches.open(
        'activities-share-target-purge-v1'
      )
      await cache.put(
        '/__share-target-pending-purge',
        new Response(String(markedAt))
      )

      await triggerFetch(shareRequest([photoFile()]))

      const ids = (await readAllShares()).map((share) => share.id)
      expect(ids).not.toContain('old')
      expect(ids).toContain('later')
      expect(ids).toHaveLength(2)
      expect(cacheStore.has('activities-share-target-purge-v1')).toBe(false)
    })

    it('counts the files past the 20-file cap as skipped', async () => {
      const files = Array.from(
        { length: 22 },
        (_, index) => new File(['x'], `p${index}.jpg`, { type: 'image/jpeg' })
      )

      await triggerFetch(shareRequest(files))

      const [share] = await readAllShares()
      expect(share.files).toHaveLength(20)
      expect(share.skipped).toBe(2)
    })

    it('stops staging files once the total budget is spent', async () => {
      const bigFile = (name: string) => ({
        name,
        type: 'video/mp4',
        size: 100 * 1024 * 1024,
        lastModified: 1,
        arrayBuffer: async () => new ArrayBuffer(1)
      })
      const files = [bigFile('a.mp4'), bigFile('b.mp4'), bigFile('c.mp4')]
      const formData = {
        getAll: () => files,
        get: () => null
      }

      await swModule.stageShareTarget(formData)

      const [share] = await readAllShares()
      expect(swModule.SHARE_TARGET_MAX_TOTAL_BYTES).toBe(250 * 1024 * 1024)
      expect(share.files.map((file: any) => file.name)).toEqual([
        'a.mp4',
        'b.mp4'
      ])
      expect(share.skipped).toBe(1)
    })

    it('caps the shared title, text and url', async () => {
      const long = 'x'.repeat(swModule.SHARE_TARGET_MAX_TEXT_LENGTH + 10)

      await triggerFetch(
        shareRequest([photoFile()], { title: long, text: long, url: long })
      )

      const [share] = await readAllShares()
      for (const field of [share.title, share.text, share.url]) {
        expect(field).toHaveLength(swModule.SHARE_TARGET_MAX_TEXT_LENGTH)
      }
    })

    it('keeps at most the newest staged shares, evicting the oldest', async () => {
      const now = Date.now()
      for (let index = 0; index < swModule.SHARE_TARGET_MAX_RECORDS; index++) {
        await writeShare({
          id: `old-${index}`,
          createdAt: now - 1000 * (index + 1),
          files: []
        })
      }

      await triggerFetch(shareRequest([photoFile()]))

      const ids = (await readAllShares()).map((share) => share.id)
      expect(ids).toHaveLength(swModule.SHARE_TARGET_MAX_RECORDS)
      expect(ids).not.toContain(`old-${swModule.SHARE_TARGET_MAX_RECORDS - 1}`)
    })

    it('refuses a share when no secure random source exists', async () => {
      vi.stubGlobal('crypto', {})

      const response = await triggerFetch(shareRequest([photoFile()]))

      vi.unstubAllGlobals()
      expect(response!.headers.get('Location')).toBe('/app?shareUnavailable=1')
    })

    it('never opens the drafts database', async () => {
      await triggerFetch(
        shareRequest([new File(['x'], 'photo.jpg', { type: 'image/jpeg' })])
      )

      const names = (await (globalThis as any).indexedDB.databases()).map(
        (db: any) => db.name
      )
      expect(names).toContain(swModule.SHARE_TARGET_DB_NAME)
      expect(names).not.toContain('activities_drafts_v1')
    })

    it('prunes shares older than 24 hours and keeps fresh ones', async () => {
      const now = Date.now()
      await writeShare({
        id: 'stale',
        createdAt: now - swModule.SHARE_TARGET_TTL_MS - 1000,
        files: []
      })
      await writeShare({ id: 'fresh', createdAt: now, files: [] })

      const db = await swModule.openShareTargetDb()
      try {
        await swModule.pruneExpiredShares(db)
      } finally {
        db.close()
      }

      const ids = (await readAllShares()).map((share) => share.id)
      expect(ids).toEqual(['fresh'])
    })

    it('prunes expired shares before staging a new one', async () => {
      await writeShare({
        id: 'stale',
        createdAt: Date.now() - swModule.SHARE_TARGET_TTL_MS - 1000,
        files: []
      })

      await triggerFetch(
        shareRequest([new File(['x'], 'photo.jpg', { type: 'image/jpeg' })])
      )

      const ids = (await readAllShares()).map((share) => share.id)
      expect(ids).not.toContain('stale')
      expect(ids).toHaveLength(1)
    })

    it('prunes expired shares on activate', async () => {
      await writeShare({
        id: 'stale',
        createdAt: Date.now() - swModule.SHARE_TARGET_TTL_MS - 1000,
        files: []
      })

      const event: any = { waitUntil: vi.fn((promise) => promise) }
      for (const listener of eventListeners['activate'] || []) listener(event)
      await Promise.all(event.waitUntil.mock.results.map((r: any) => r.value))

      expect(await readAllShares()).toEqual([])
    })

    it('falls back to the unavailable redirect when staging fails', async () => {
      vi.stubGlobal('indexedDB', undefined)
      ;(globalThis as any).indexedDB = undefined

      const response = await triggerFetch(
        shareRequest([new File(['x'], 'photo.jpg', { type: 'image/jpeg' })])
      )

      expect(response!.status).toBe(303)
      expect(response!.headers.get('Location')).toBe('/app?shareUnavailable=1')
    })

    it('leaves other POSTs and GETs to the browser', async () => {
      const otherPost = new Request('https://llun.social/api/v1/statuses', {
        method: 'POST',
        body: 'x'
      })
      expect(await triggerFetch(otherPost)).toBeNull()

      const shareGet = new Request('https://llun.social/_share-target')
      expect(await triggerFetch(shareGet)).toBeNull()

      expect(await readAllShares()).toEqual([])
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
